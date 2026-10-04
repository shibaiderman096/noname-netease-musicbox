/**
 * 网易云音乐盒 - 底层网络请求
 *
 * 桌面端（nodeIntegration）优先使用 Node 的 http/https：
 *  - 不受页面 CORS 限制
 *  - 可以完整读取 Set-Cookie（扫码登录必须）
 * 浏览器端退化为 fetch（跨域会失败，仅作兜底）。
 */
import { getRequire } from "./util.js";

let nodeModules;
function loadNodeModules() {
	if (nodeModules !== undefined) {
		return nodeModules;
	}
	nodeModules = null;
	const req = getRequire();
	if (req) {
		try {
			nodeModules = {
				https: req("https"),
				http: req("http"),
			};
		} catch (e) {
			nodeModules = null;
		}
	}
	return nodeModules;
}

/** 是否具备 Node 网络能力 */
export function hasNodeNetwork() {
	return !!loadNodeModules();
}

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
					resolve({
						status,
						headers: res.headers,
						text: buffer.toString("utf8"),
						buffer,
					});
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

async function fetchRequest(options, redirectCount = 0) {
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

/**
 * 发起请求
 * @param {{ url: string, method?: string, headers?: Record<string, string>, body?: string, timeout?: number }} options
 * @returns {Promise<{ status: number, headers: Record<string, any>, text: string, buffer: any }>}
 */
export function request(options) {
	if (hasNodeNetwork()) {
		return nodeRequest(options);
	}
	return fetchRequest(options);
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
	const raw = headers["set-cookie"];
	if (!raw) {
		return [];
	}
	return Array.isArray(raw) ? raw : [raw];
}

export const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
