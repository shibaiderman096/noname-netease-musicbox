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

/* ---------------- Capacitor（由理/cola 等 Capacitor 壳客户端） ---------------- */

function getCapacitor() {
	const win = getWindow();
	return win && win.Capacitor && typeof win.Capacitor === "object" ? win.Capacitor : null;
}

/**
 * 取得 Capacitor 原生 HTTP 通道（CapacitorHttp）。
 * 依次尝试：已注册插件代理 -> 通用 nativePromise -> toNative 回调 -> 原生接口
 */
function getCapacitorHttp() {
	const win = getWindow();
	const capacitor = getCapacitor();
	if (capacitor) {
		const plugin = capacitor.Plugins && capacitor.Plugins.CapacitorHttp;
		if (plugin && typeof plugin.request === "function") {
			return { style: "plugin", request: options => plugin.request(options) };
		}
		if (typeof capacitor.nativePromise === "function") {
			return { style: "nativePromise", request: options => capacitor.nativePromise("CapacitorHttp", "request", options) };
		}
		if (typeof capacitor.toNative === "function" && typeof capacitor.nativeCallback === "function") {
			return {
				style: "nativeCallback",
				request: options =>
					new Promise((resolve, reject) => {
						capacitor.nativeCallback(
							"CapacitorHttp",
							"request",
							options,
							(response, error) => (error ? reject(new Error(error.message || "原生请求失败")) : resolve(response))
						);
					}),
			};
		}
	}
	// 兜底：直接调用注入的原生接口（同步返回 JSON 字符串）
	const raw = win && win.CapacitorHttpAndroidInterface;
	if (raw && typeof raw.request === "function") {
		return {
			style: "rawInterface",
			request: options =>
				new Promise((resolve, reject) => {
					try {
						resolve(JSON.parse(raw.request(JSON.stringify(options))));
					} catch (e) {
						reject(new Error(`原生接口调用失败：${(e && e.message) || e}`));
					}
				}),
		};
	}
	return null;
}

/** 是否可用 Capacitor 原生 HTTP */
export function hasCapacitorHttp() {
	return !!getCapacitorHttp();
}

function normalizeCapacitorResponse(response) {
	if (!response) {
		throw new Error("原生请求没有返回内容");
	}
	if (response.error) {
		const message = typeof response.error === "string" ? response.error : response.error.message || JSON.stringify(response.error);
		throw new Error(message);
	}
	const data = response.data;
	return {
		status: response.status || 200,
		headers: response.headers || {},
		text: typeof data === "string" ? data : data === undefined || data === null ? "" : JSON.stringify(data),
		buffer: null,
	};
}

function capacitorHttpRequest(options) {
	const http = getCapacitorHttp();
	if (!http) {
		return Promise.reject(new Error("Capacitor 原生 HTTP 不可用"));
	}
	const method = (options.method || "GET").toUpperCase();
	const payload = {
		url: options.url,
		method,
		headers: options.headers || {},
		connectTimeout: options.timeout || 20000,
		readTimeout: options.timeout || 20000,
	};
	if (options.body && method !== "GET") {
		payload.data = options.body;
		payload.dataType = "string";
	}
	return Promise.resolve()
		.then(() => http.request(payload))
		.then(normalizeCapacitorResponse);
}

/** 是否可用 cordova-plugin-file-transfer（只要求 FileTransfer 本体，不强求 cordova.file） */
export function hasFileTransfer() {
	const win = getWindow();
	return !!(win && typeof win.FileTransfer === "function");
}

/** 是否具备可用的文件系统 API（FileTransfer 上传/下载需要写临时文件） */
export function hasCordovaFileSystem() {
	const win = getWindow();
	if (!win || typeof win.resolveLocalFileSystemURL !== "function") {
		return false;
	}
	return !!(workingDirHint() || (win.cordova && win.cordova.file));
}

/** 手动指定后端（诊断用，空字符串 = 自动） */
let forcedBackend = "";
export function setForcedBackend(name) {
	forcedBackend = name || "";
}
export function getForcedBackend() {
	return forcedBackend;
}

/** 当前实际使用的网络后端 */
export function currentBackend() {
	if (forcedBackend) {
		return forcedBackend;
	}
	if (hasNodeNetwork()) {
		return "node";
	}
	if (hasCapacitorHttp()) {
		return "capacitor-http";
	}
	if (hasCordovaHttp()) {
		return "cordova-http";
	}
	if (hasFileTransfer() && hasCordovaFileSystem()) {
		return "file-transfer";
	}
	return "fetch";
}

/** 后端的中文说明（用于界面提示） */
export function backendLabel() {
	if (forcedBackend) {
		return `${backendName(forcedBackend)}（手动指定）`;
	}
	return backendName(currentBackend());
}

function backendName(name) {
	switch (name) {
		case "node":
			return "桌面端（Node）";
		case "capacitor-http":
			return "安卓客户端（Capacitor 原生 HTTP）";
		case "cordova-http":
			return "安卓客户端（原生 HTTP）";
		case "file-transfer":
			return "安卓客户端（原生文件传输）";
		default:
			return "浏览器 fetch（会受跨域限制）";
	}
}

/** 当前后端能否读取响应头（扫码登录需要 Set-Cookie） */
export function canReadResponseHeaders() {
	const backend = currentBackend();
	return backend === "node" || backend === "capacitor-http" || backend === "cordova-http";
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

/** 可写目录的候选（优先用游戏自己的数据目录，和 game.download 保持一致） */
function workingDirHint() {
	const win = getWindow();
	try {
		const inited = win && win.localStorage && win.localStorage.getItem("noname_inited");
		if (inited) {
			return inited;
		}
	} catch (e) {}
	const file = win && win.cordova && win.cordova.file;
	if (file) {
		const dir = file.externalDataDirectory || file.dataDirectory || file.cacheDirectory || file.externalCacheDirectory;
		if (dir) {
			return dir;
		}
	}
	return "";
}

/**
 * 取入口的 file:// 路径。
 * 注意：cordova-plugin-file 的 entry.toURL() 返回 cdvfile:// 形式，
 * 而 cordova-plugin-file-transfer 的 Java 端解析 cdvfile:// 会得到 null 并抛
 * NullPointerException，所以必须优先用 nativeURL / toInternalURL()（file:///… 形式）。
 */
function pathOf(entry, fallback) {
	if (!entry) {
		return fallback;
	}
	if (typeof entry.nativeURL === "string" && entry.nativeURL) {
		return entry.nativeURL;
	}
	if (typeof entry.toInternalURL === "function") {
		try {
			const url = entry.toInternalURL();
			if (url) {
				return url;
			}
		} catch (e) {}
	}
	return fallback;
}

/** 目录路径统一以 / 结尾 */
function ensureSlash(path) {
	return path.endsWith("/") ? path : `${path}/`;
}

/** 取得（并按需创建）一个可写的临时目录，返回 file:/// 形式且以 / 结尾 */
function resolveWorkingDir() {
	return new Promise((resolve, reject) => {
		const win = getWindow();
		const base = workingDirHint();
		if (!win || typeof win.resolveLocalFileSystemURL !== "function" || !base) {
			reject(new Error("客户端没有可用的文件系统接口"));
			return;
		}
		win.resolveLocalFileSystemURL(
			base,
			entry => {
				entry.getDirectory(
					"nmb-tmp",
					{ create: true },
					dirEntry => resolve(ensureSlash(pathOf(dirEntry, `${ensureSlash(base)}nmb-tmp/`))),
					() => {
						// 有些客户端的根目录不允许建子目录，就直接用原目录
						resolve(ensureSlash(pathOf(entry, ensureSlash(base))));
					}
				);
			},
			() => reject(new Error(`无法访问客户端缓存目录：${base}`))
		);
	});
}

/** 写一个临时文件（充当上传体），返回 file:/// 路径 */
async function writeTempFile(name, content) {
	const win = getWindow();
	const dir = await resolveWorkingDir();
	return new Promise((resolve, reject) => {
		win.resolveLocalFileSystemURL(
			dir,
			entry => {
				entry.getFile(
					name,
					{ create: true },
					fileEntry => {
						fileEntry.createWriter(
							writer => {
								writer.onwriteend = () => resolve(pathOf(fileEntry, `${dir}${name}`));
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
		return resolveWorkingDir().then(
			dir =>
				new Promise((resolve, reject) => {
					const target = encodeURI(`${dir}nmb-get.json`);
					const fail = error => {
						const status = error && error.http_status ? Number(error.http_status) : 0;
						if (status > 0) {
							resolve({ status, headers: {}, text: error.body || "", buffer: null });
							return;
						}
						const detail = (error && (error.body || error.exception || error.code)) || "网络请求失败";
						reject(new Error(`${detail}（目标路径：${target}）`));
					};
					// 注意：绝不能把 async 函数交给 Cordova 当回调，
					// 否则 argscheck 会报：Expected Function, but got AsyncFunction
					const done = entry => {
						readTempFile(entry).then(
							text => resolve({ status: 200, headers: {}, text, buffer: null }),
							reject
						);
					};
					let fileTransfer;
					try {
						fileTransfer = new win.FileTransfer();
					} catch (e) {
						reject(new Error(`无法创建 FileTransfer：${(e && e.message) || e}`));
						return;
					}
					// 和 game.download 一致：文件路径要 encodeURI（可能含空格），
					// 但请求 URL 绝不能 encodeURI —— 接口参数已经 %XX 编码过，
					// encodeURI 会把 %2B 变成 %252B 导致服务端解密失败。
					// options 只在真的需要（带 Cookie）时才传：部分客户端的 file-transfer
					// 收到 options 会在 Java 端抛 NullPointerException（已实测到）。
					const headers = options.headers || {};
					const needCookie = Object.keys(headers).some(key => key.toLowerCase() === "cookie");
					try {
						if (needCookie) {
							fileTransfer.download(options.url, target, done, fail, false, { headers });
						} else {
							fileTransfer.download(options.url, target, done, fail);
						}
					} catch (e) {
						reject(new Error(`FileTransfer 下载异常：${(e && e.message) || e}`));
					}
				})
		);
	}

	// POST：参数已在查询串上，body 用一个占位文件代替（服务端只读查询串）
	return writeTempFile("nmb-post.txt", "x").then(
		path =>
			new Promise((resolve, reject) => {
				const fail = error => {
					const status = error && error.http_status ? Number(error.http_status) : 0;
					if (status > 0) {
						resolve({ status, headers: {}, text: error.body || "", buffer: null });
						return;
					}
					const detail = (error && (error.body || error.exception || error.code)) || "网络请求失败";
					reject(new Error(`${detail}（上传体：${path}）`));
				};
				let fileTransfer;
				try {
					fileTransfer = new win.FileTransfer();
				} catch (e) {
					reject(new Error(`无法创建 FileTransfer：${(e && e.message) || e}`));
					return;
				}
				try {
					fileTransfer.upload(
						encodeURI(path),
						options.url,
						result => {
							resolve({
								status: (result && result.responseCode) || 200,
								headers: {},
								text: (result && result.response) || "",
								buffer: null,
							});
						},
						fail,
						{
							headers: options.headers || {},
							fileKey: "nmb",
							fileName: "nmb.txt",
							mimeType: "text/plain",
							chunkedMode: false,
						}
					);
				} catch (e) {
					reject(new Error(`FileTransfer 上传异常：${(e && e.message) || e}`));
				}
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
		case "capacitor-http":
			return capacitorHttpRequest(options);
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

/** 读取响应中的 Set-Cookie 列表（大小写不敏感） */
export function readSetCookie(headers) {
	if (!headers) {
		return [];
	}
	let raw = headers["set-cookie"] || headers["Set-Cookie"];
	if (!raw) {
		for (const key of Object.keys(headers)) {
			if (key.toLowerCase() === "set-cookie") {
				raw = headers[key];
				break;
			}
		}
	}
	if (!raw) {
		return [];
	}
	return Array.isArray(raw) ? raw : [raw];
}

/* ------------------------------------------------------------------ *
 * 网络诊断（安卓端排查用：把结果复制反馈即可定位缺哪条通道）
 * ------------------------------------------------------------------ */

function describeObject(obj) {
	if (obj === undefined) {
		return "未定义";
	}
	if (obj === null) {
		return "null";
	}
	const methods = [];
	const props = [];
	let keys = [];
	try {
		keys = Object.keys(obj);
	} catch (e) {
		return `(${typeof obj}) 无法枚举`;
	}
	for (const key of keys.slice(0, 60)) {
		try {
			if (typeof obj[key] === "function") {
				methods.push(key);
			} else if (typeof obj[key] === "string" || typeof obj[key] === "number" || typeof obj[key] === "boolean") {
				props.push(`${key}=${String(obj[key]).slice(0, 24)}`);
			} else {
				props.push(`${key}:${typeof obj[key]}`);
			}
		} catch (e) {
			props.push(`${key}:读取失败`);
		}
	}
	const head = `(${typeof obj})`;
	const methodText = methods.length ? `方法[${methods.join(" ")}]` : "无方法";
	const propText = props.length ? `属性[${props.slice(0, 20).join(" ")}]` : "";
	return `${head} ${methodText} ${propText}`.trim();
}

function probeWithTimeout(run, timeout = 8000) {
	return new Promise(resolve => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				resolve("超时（无响应）");
			}
		}, timeout);
		Promise.resolve()
			.then(run)
			.then(
				value => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						resolve(value);
					}
				},
				error => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						resolve(`失败：${(error && error.name) || "Error"} - ${(error && error.message) || error}`);
					}
				}
			);
	});
}

/**
 * 采集运行环境信息（安卓端排查网络通道用）
 * @returns {Promise<string>} 可直接复制反馈的文本
 */
export async function diagnose() {
	const win = getWindow();
	const lines = [];
	const push = (key, value) => lines.push(`${key}: ${value}`);

	push("扩展版本", "1.4.2"); // 与 extension.js 的 VERSION / info.json 保持一致
	push("时间", new Date().toLocaleString());
	push("UA", (typeof navigator !== "undefined" && navigator.userAgent) || "?");
	push("页面地址", (win && win.location && win.location.href) || "?");
	push("origin/protocol", win && win.location ? `${win.location.origin} / ${win.location.protocol}` : "?");
	push("当前网络通道", backendLabel());
	push("手动指定", forcedBackend || "（自动）");

	push("--- 能力探测 ---");
	push("cordova", describeObject(win && win.cordova));
	push("cordova.plugins", describeObject(win && win.cordova && win.cordova.plugins));
	push("cordova.plugin", describeObject(win && win.cordova && win.cordova.plugin));
	push("cordova.file", describeObject(win && win.cordova && win.cordova.file));
	push("FileTransfer", typeof (win && win.FileTransfer));
	push("resolveLocalFileSystemURL", typeof (win && win.resolveLocalFileSystemURL));
	push("localStorage.noname_inited", (() => {
		try {
			return (win.localStorage && win.localStorage.getItem("noname_inited")) || "（空）";
		} catch (e) {
			return "读取失败";
		}
	})());
	push("fetch", typeof fetch);
	push("XMLHttpRequest", typeof XMLHttpRequest);

	push("--- 疑似原生桥接 ---");
	for (const name of ["Capacitor", "NonameAndroidBridge", "noname_shijianInterfaces", "AndroidBridge", "Android", "nonameAndroid", "NonameBridge", "webkit", "plus", "cordova"]) {
		const obj = win && win[name];
		if (obj === undefined) {
			continue;
		}
		push(name, describeObject(obj));
	}
	// Capacitor 细节
	const capacitor = getCapacitor();
	if (capacitor) {
		push("Capacitor.Plugins", describeObject(capacitor.Plugins));
		push("Capacitor 全局方法", describeObject(capacitor));
		push("CapacitorHttp 通道", hasCapacitorHttp() ? `可用（${getCapacitorHttp().style}）` : "不可用");
		try {
			const raw = win.CapacitorHttpAndroidInterface;
			if (raw) {
				push("CapacitorHttpAndroidInterface.isEnabled()", typeof raw.isEnabled === "function" ? String(raw.isEnabled()) : "无 isEnabled");
			}
		} catch (e) {}
	}
	try {
		const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
		push("页面 CSP", csp ? csp.getAttribute("content").slice(0, 200) : "未设置");
	} catch (e) {}
	const guessed = [];
	try {
		for (const key of Object.keys(win || {})) {
			if (!/bridge|android|native|noname|plus|interface/i.test(key)) {
				continue;
			}
			if (["NonameAndroidBridge", "noname_shijianInterfaces", "AndroidBridge", "Android", "nonameAndroid", "NonameBridge", "webkit", "plus", "cordova", "Capacitor"].includes(key)) {
				continue;
			}
			let type = typeof win[key];
			guessed.push(`${key}(${type})`);
		}
	} catch (e) {}
	push("其它疑似对象", guessed.slice(0, 30).join(" ") || "（无）");

	push("--- 连通性测试（GET music.163.com）---");
	const testUrl = "https://music.163.com/song/media/outer/url?id=347230.mp3";
	push(
		"fetch",
		await probeWithTimeout(async () => {
			const res = await fetch(testUrl, { method: "GET" });
			return `HTTP ${res.status}`;
		})
	);
	push(
		"XMLHttpRequest",
		await probeWithTimeout(
			() =>
				new Promise((resolve, reject) => {
					const xhr = new XMLHttpRequest();
					xhr.open("GET", testUrl, true);
					xhr.timeout = 6000;
					xhr.onload = () => resolve(`HTTP ${xhr.status}`);
					xhr.onerror = () => reject(new Error("网络错误（多为跨域被拦）"));
					xhr.ontimeout = () => reject(new Error("超时"));
					xhr.send();
				})
		)
	);
	push(
		"fetch(api.github.com)",
		await probeWithTimeout(async () => {
			const res = await fetch("https://api.github.com/repos/shibaiderman096/noname-netease-musicbox/releases/latest", {
				headers: { Accept: "application/vnd.github+json" },
			});
			return `HTTP ${res.status}`;
		})
	);
	push(
		"CapacitorHttp 请求",
		await probeWithTimeout(async () => {
			if (!hasCapacitorHttp()) {
				return "不可用";
			}
			const response = await capacitorHttpRequest({ url: testUrl, method: "GET", timeout: 10000 });
			return `HTTP ${response.status}（${String(response.text).length} 字节）`;
		}, 12000)
	);
	push(
		"FileTransfer 缓存目录",
		await probeWithTimeout(async () => {
			if (!hasFileTransfer() && !hasCordovaFileSystem()) {
				return "无文件系统接口";
			}
			return await resolveWorkingDir();
		}, 8000)
	);
	push(
		"FileTransfer 下载（实际使用的代码路径）",
		await probeWithTimeout(async () => {
			if (!hasFileTransfer()) {
				return "无 FileTransfer";
			}
			const response = await fileTransferRequest({ url: testUrl, method: "GET", headers: {} });
			return `HTTP ${response.status}（${String(response.text).length} 字节）`;
		}, 15000)
	);
	push(
		"FileTransfer 下载（带空 options，复现旧版 NPE）",
		await probeWithTimeout(async () => {
			if (!hasFileTransfer()) {
				return "无 FileTransfer";
			}
			const dir = await resolveWorkingDir();
			return await new Promise((resolve, reject) => {
				const fileTransfer = new (getWindow().FileTransfer)();
				fileTransfer.download(
					encodeURI(testUrl),
					encodeURI(`${dir}nmb-diag.json`),
					() => resolve("成功"),
					error => reject(new Error((error && (error.body || error.exception)) || `http_status=${error && error.http_status}`)),
					false,
					{}
				);
			});
		}, 12000)
	);
	push(
		"FileTransfer 上传（POST，安卓端接口调用靠它）",
		await probeWithTimeout(async () => {
			if (!hasFileTransfer()) {
				return "无 FileTransfer";
			}
			const response = await fileTransferRequest({
				url: "https://api.github.com/zen",
				method: "POST",
				headers: { "User-Agent": "noname-netease-musicbox", Accept: "text/plain" },
				body: "x",
			});
			// 这里只验证"原生上传通道能拿到 HTTP 响应"，4xx 也算通道可用
			return `HTTP ${response.status}（收到 ${String(response.text).length} 字节，能拿到响应即通道可用）`;
		}, 15000)
	);

	return lines.join("\n");
}

export const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
