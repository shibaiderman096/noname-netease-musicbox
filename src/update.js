/**
 * 网易云音乐盒 - 版本检查与仓库链接
 */
import { request } from "./net.js";

export const REPO_URL = "https://github.com/shibaiderman096/noname-netease-musicbox";
export const RELEASES_URL = `${REPO_URL}/releases`;
const LATEST_API = "https://api.github.com/repos/shibaiderman096/noname-netease-musicbox/releases/latest";

function parseVersion(text) {
	return String(text || "")
		.replace(/^v/i, "")
		.split(/[.+-]/)
		.map(part => parseInt(part, 10) || 0);
}

/** 比较版本号：a > b 返回 1，a < b 返回 -1，相同返回 0 */
export function compareVersion(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		const diff = (left[i] || 0) - (right[i] || 0);
		if (diff !== 0) {
			return diff > 0 ? 1 : -1;
		}
	}
	return 0;
}

/**
 * 查询 GitHub 上的最新 Release
 * @param {string} current 当前版本号
 */
export async function checkUpdate(current) {
	const response = await request({
		url: LATEST_API,
		method: "GET",
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "noname-netease-musicbox",
		},
		timeout: 15000,
	});
	if (response.status === 404) {
		throw new Error("仓库还没有发布任何版本");
	}
	if (response.status === 403) {
		throw new Error("GitHub 接口访问受限（403，通常是同一网络请求过多），请稍后再试");
	}
	if (response.status !== 200) {
		throw new Error(`接口返回 HTTP ${response.status}`);
	}
	let release;
	try {
		release = JSON.parse(response.text);
	} catch (e) {
		throw new Error("返回内容解析失败");
	}
	const latest = String(release.tag_name || release.name || "").trim();
	return {
		current: String(current || ""),
		latest: latest.replace(/^v/i, "") || "未知",
		hasUpdate: compareVersion(latest, current) > 0,
		url: release.html_url || RELEASES_URL,
		name: release.name || "",
		publishedAt: release.published_at || "",
	};
}
