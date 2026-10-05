/**
 * 网易云音乐盒 - 底层网络请求
 *
 * 多套后端，按可用性自动选择：
 *   1. node          —— 无名杀桌面端（Electron，nodeIntegration）：不受 CORS 限制，可读 Set-Cookie
 *   2. cordova-http  —— 安卓/iOS 客户端装了 cordova-plugin-advanced-http 时：原生请求，可设任意请求头
 *   3. file-transfer —— 安卓/iOS 客户端（cordova-plugin-file/-file-transfer）：原生 POST/GET，同样绕开 CORS
 *   4. fetch         —— 兜底（网页版；music.163.com 不返回 CORS 头，浏览器会拦下并报 Failed to fetch）
 *
 * 重要：网易云接口不接受 GET 传参，但**接受把 params/encSecKey 放在查询串上的 POST**
 * （实测 multipart / urlencoded / text / 空 body 全部返回 200），因此 api.js 统一把参数放在查询串，
 * 这样安卓端用原生「上传/下载」通道也能正常调用接口。
 */
import { getRequire } from "./util.js";

/* ------------------------------------------------------------------ *
 * 环境探测
 * ------------------------------------------------------------------ */

function getWindow() {
	return typeof window !== "undefined" ? window : null;
}

function getCordova() {
	const win = getWindow();
	if (!win || !win.cordova || typeof win.cordova !== "object") {
		return null;
	}
	return win.cordova;
}

let nodeModules;
function loadNodeModules() {
	if (nodeModules !== undefined) {
		return nodeModules;
	}
	nodeModules = null;
	const req = getRequire();
	if (req) {
		try {
			nodeModules = { https: req("https"), http: req("http") };
		} catch (e) {
			nodeModules = null;
		}
	}
	return nodeModules;
}

/** 是否具备 Node 网络能力（桌面端） */
export function hasNodeNetwork() {
	return !!loadNodeModules();
}

/** 是否可用 cordova-plugin-advanced-http */
export function hasCordovaHttp() {
	const cordova = getCordova();
	return !!(cordova && cordova.plugin && cordova.plugin.http && typeof cordova.plugin.http.sendRequest === "function");
}

/** 是否可用 cordova-plugin-file-transfer */
export function hasFileTransfer() {
	const win = getWindow();
	return !!(win && typeof win.FileTransfer === "function" && win.cordova && win.cordova.file);
}

/** 当前实际使用的网络后端 */
export function currentBackend() {
	if (hasNodeNetwork()) {
		return "node";
	}
	if (hasCordovaHttp()) {
		return "cordova-http";
	}
	if (hasFileTransfer()) {
		return "file-transfer";
	}
	return "fetch";
}

/** 后端的中文说明（用于界面提示） */
export function backendLabel() {
	switch (currentBackend()) {
		case "node":
			return "桌面端（Node）";
		case "cordova-http":
			return "安卓客户端（原生 HTTP）";
		case "file-transfer":
			return "安卓客户端（原生文件传输）";
		default:
			return "浏览器 fetch（可能受跨域限制）";
	}
}

/** 当前后端能否读取响应头（扫码登录需要 Set-Cookie） */
export function canReadResponseHeaders() {
	const backend = currentBackend();
	return backend === "node" || backend === "cordova-http";
}

/* ------------------------------------------------------------------ *
 * 后端 1：Node（桌面端）
 * ------------------------------------------------------------------ */

function nodeRequest(options, redirectCount = 0) {
	return new Promise((resolve, reject) => {
		const modules = loadNodeModules();
		const target = new URL(options.url);
		const mod = target.protocol === "http:" ? modules.http : modules.https;
		const req = mod.request(
			{
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port || (target.protocol === "http:" ? 80 : 443),
				path: `${target.pathname}${target.search}`,
				method: options.method || "GET",
				headers: options.headers || {},
			},
			res => {
				const status = res.statusCode || 0;
				if (status >= 300 && status < 400 && res.headers.location && redirectCount < 5) {
					res.resume();
					const nextUrl = new URL(res.headers.location, options.url).toString();
					resolve(nodeRequest({ ...options, url: nextUrl, method: "GET", body: undefined }, redirectCount + 1));
					return;
				}
				const chunks = [];
				res.on("data", chunk => chunks.push(chunk));
				res.on("end", () => {
					const buffer = Buffer.concat(chunks);
					resolve({ status, headers: res.headers, text: buffer.toString("utf8"), buffer });
				});
				res.on("error", reject);
			}
		);
		req.on("error", reject);
		req.setTimeout(options.timeout || 20000, () => {
			req.destroy(new Error("网络请求超时"));
		});
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

/* ------------------------------------------------------------------ *
 * 后端 2：cordova-plugin-advanced-http
 * ------------------------------------------------------------------ */

function cordovaHttpRequest(options) {
	return new Promise((resolve, reject) => {
		const http = getCordova().plugin.http;
		const method = (options.method || "GET").toLowerCase();
		try {
			if (http.setDataSerializer) {
				http.setDataSerializer("utf8");
			}
		} catch (e) {}
		const payload = { method, headers: options.headers || {}, timeout: options.timeout || 20000 };
		if (options.body && method !== "get") {
			payload.data = options.body;
		}
		http.sendRequest(
			options.url,
			payload,
			response => {
				resolve({
					status: response.status || 200,
					headers: response.headers || {},
					text: typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? ""),
					buffer: null,
				});
			},
			response => {
				const status = response && response.status ? Number(response.status) : 0;
				if (status > 0) {
					resolve({ status, headers: (response && response.headers) || {}, text: (response && response.error) || "", buffer: null });
					return;
				}
				const message = response && response.error ? String(response.error) : "网络请求失败";
				reject(new Error(message));
			}
		);
	});
}

/* ------------------------------------------------------------------ *
 * 后端 3：cordova-plugin-file-transfer（POST 走 upload，GET 走 download）
 * ------------------------------------------------------------------ */

function cacheDirectory() {
	const win = getWindow();
	const file = win && win.cordova && win.cordova.file;
	return file ? file.cacheDirectory || file.externalCacheDirectory || file.dataDirectory : null;
}

/** 写一个临时文件（充当上传体） */
function writeTempFile(name, content) {
	return new Promise((resolve, reject) => {
		const win = getWindow();
		const dir = cacheDirectory();
		if (!dir || typeof win.resolveLocalFileSystemURL !== "function") {
			reject(new Error("无法访问客户端缓存目录"));
			return;
		}
		win.resolveLocalFileSystemURL(
			dir,
			entry => {
				entry.getFile(
					name,
					{ create: true },
					fileEntry => {
						fileEntry.createWriter(
							writer => {
								writer.onwriteend = () => resolve(fileEntry.toURL ? fileEntry.toURL() : fileEntry.nativeURL || `${dir}${name}`);
								writer.onerror = () => reject(new Error("写入临时文件失败"));
								try {
									writer.write(new Blob([content], { type: "text/plain" }));
								} catch (e) {
									reject(new Error("写入临时文件失败"));
								}
							},
							() => reject(new Error("写入临时文件失败"))
						);
					},
					() => reject(new Error("创建临时文件失败"))
				);
			},
			() => reject(new Error("无法访问客户端缓存目录"))
		);
	});
}

/** 读取临时文件内容 */
function readTempFile(fileEntry) {
	return new Promise((resolve, reject) => {
		const win = getWindow();
		fileEntry.file(
			file => {
				const reader = new win.FileReader();
				reader.onload = () => resolve(String(reader.result || ""));
				reader.onerror = () => reject(new Error("读取响应内容失败"));
				reader.readAsText(file, "UTF-8");
			},
			() => reject(new Error("读取响应内容失败"))
		);
	});
}

function fileTransferRequest(options) {
	const method = (options.method || "GET").toUpperCase();
	const win = getWindow();

	if (method === "GET") {
		return new Promise((resolve, reject) => {
			const dir = cacheDirectory();
			if (!dir) {
				reject(new Error("无法访问客户端缓存目录"));
				return;
			}
			const fileTransfer = new win.FileTransfer();
			fileTransfer.download(
				options.url,
				`${dir}nmb-get.json`,
				async entry => {
					try {
						resolve({ status: 200, headers: {}, text: await readTempFile(entry), buffer: null });
					} catch (e) {
						reject(e);
					}
				},
				error => {
					const status = error && error.http_status ? Number(error.http_status) : 0;
					if (status > 0) {
						resolve({ status, headers: {}, text: error.body || "", buffer: null });
						return;
					}
					reject(new Error((error && (error.body || error.exception)) || "网络请求失败"));
				},
				false,
				{ headers: options.headers || {} }
			);
		});
	}

	// POST：参数已在查询串上，body 用一个占位文件代替（服务端只读查询串）
	return writeTempFile("nmb-post.txt", "x").then(
		path =>
			new Promise((resolve, reject) => {
				const fileTransfer = new win.FileTransfer();
				fileTransfer.upload(
					path,
					options.url,
					result => {
						resolve({
							status: (result && result.responseCode) || 200,
							headers: {},
							text: (result && result.response) || "",
							buffer: null,
						});
					},
					error => {
						const status = error && error.http_status ? Number(error.http_status) : 0;
						if (status > 0) {
							resolve({ status, headers: {}, text: error.body || "", buffer: null });
							return;
						}
						reject(new Error((error && (error.body || error.exception)) || "网络请求失败"));
					},
					{
						headers: options.headers || {},
						fileKey: "nmb",
						fileName: "nmb.txt",
						mimeType: "text/plain",
						chunkedMode: false,
					}
				);
			})
	);
}

/* ------------------------------------------------------------------ *
 * 后端 4：fetch（兜底）
 * ------------------------------------------------------------------ */

async function fetchRequest(options) {
	const response = await fetch(options.url, {
		method: options.method || "GET",
		headers: options.headers,
		body: options.body,
		credentials: "include",
		redirect: "follow",
	});
	const text = await response.text();
	const headers = {};
	try {
		response.headers.forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
	} catch (e) {}
	return { status: response.status, headers, text, buffer: null };
}

/* ------------------------------------------------------------------ *
 * 统一入口
 * ------------------------------------------------------------------ */

/**
 * 发起请求
 * @param {{ url: string, method?: string, headers?: Record<string, string>, body?: string, timeout?: number }} options
 * @returns {Promise<{ status: number, headers: Record<string, any>, text: string, buffer: any }>}
 */
export function request(options) {
	switch (currentBackend()) {
		case "node":
			return nodeRequest(options);
		case "cordova-http":
			return cordovaHttpRequest(options);
		case "file-transfer":
			return fileTransferRequest(options);
		default:
			return fetchRequest(options);
	}
}

/**
 * 发起请求并解析 JSON
 * @returns {Promise<any>}
 */
export async function requestJson(options) {
	const response = await request(options);
	try {
		return JSON.parse(response.text);
	} catch (e) {
		throw new Error(`返回内容不是合法的 JSON（HTTP ${response.status}）：${response.text.slice(0, 120)}`);
	}
}

/** 读取响应中的 Set-Cookie 列表 */
export function readSetCookie(headers) {
	if (!headers) {
		return [];
	}
	const raw = headers["set-cookie"] || headers["Set-Cookie"];
	if (!raw) {
		return [];
	}
	return Array.isArray(raw) ? raw : [raw];
}

export const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
