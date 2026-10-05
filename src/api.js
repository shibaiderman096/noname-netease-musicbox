/**
 * 网易云音乐盒 - 网易云接口封装（weapi）
 *
 * 本模块不依赖无名杀，可单独在 Node 中运行测试。
 */
import { weapi } from "./crypto.js";
import { request, readSetCookie, USER_AGENT } from "./net.js";
import { BASE_URL } from "./util.js";

/** 匿名访问所需的基础 Cookie */
const ANON_COOKIE = "os=pc; appver=2.10.6; channel=netease; __csrf=";

let userCookie = "";
let csrfToken = "";

/** 设置登录会话 Cookie */
export function setCookie(value) {
	userCookie = String(value || "").trim();
	const matched = /__csrf=([^;]*)/.exec(userCookie);
	csrfToken = matched ? matched[1] : "";
}

/** 获取当前 Cookie */
export function getCookie() {
	return userCookie;
}

/** 合并响应里的 Set-Cookie（扫码登录成功后由这里拿到 MUSIC_U） */
function absorbCookies(headers) {
	const list = readSetCookie(headers);
	if (!list.length) {
		return;
	}
	const jar = new Map();
	for (const part of userCookie.split(";")) {
		const index = part.indexOf("=");
		if (index > 0) {
			jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
		}
	}
	for (const item of list) {
		const [pair] = String(item).split(";");
		const index = pair.indexOf("=");
		if (index > 0) {
			const name = pair.slice(0, index).trim();
			const value = pair.slice(index + 1).trim();
			if (name && value && value !== "EXPIRED") {
				jar.set(name, value);
			}
		}
	}
	setCookie(
		[...jar.entries()]
			.map(([name, value]) => `${name}=${value}`)
			.join("; ")
	);
}

/** 是否已拿到登录态 */
export function isLoggedIn() {
	return /MUSIC_U=[^;]+/.test(userCookie);
}

/** 构造请求头 */
function buildHeaders() {
	const cookieParts = [userCookie, ANON_COOKIE].filter(Boolean).join("; ");
	return {
		"Content-Type": "application/x-www-form-urlencoded",
		Referer: `${BASE_URL}/`,
		Origin: BASE_URL,
		"User-Agent": USER_AGENT,
		Cookie: cookieParts,
	};
}

/** 发送 weapi 请求，返回原始响应 */
async function weapiRaw(path, params = {}) {
	const payload = weapi({ ...params, csrf_token: csrfToken });
	const body = `params=${encodeURIComponent(payload.params)}&encSecKey=${encodeURIComponent(payload.encSecKey)}`;
	// 参数同时放在查询串和 body 里：安卓客户端用原生「上传」通道时 body 只能是 multipart 占位文件，
	// 而服务端在查询串里同样能读到 params/encSecKey（各 body 形态实测均返回 200）。
	const query = `${body}&csrf_token=${encodeURIComponent(csrfToken)}`;
	const response = await request({
		url: `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}${query}`,
		method: "POST",
		headers: buildHeaders(),
		body,
	});
	absorbCookies(response.headers);
	let json;
	try {
		json = JSON.parse(response.text);
	} catch (e) {
		throw new Error(`接口返回异常（HTTP ${response.status}）：${response.text.slice(0, 120)}`);
	}
	return json;
}

/** 发送 weapi 请求并返回 JSON */
async function weapiPost(path, params = {}) {
	const json = await weapiRaw(path, params);
	if (json && json.code === -462) {
		throw new Error("请求过于频繁，请稍后再试");
	}
	return json;
}

/** 检查返回码 */
function ensure(json, action) {
	if (!json || (json.code !== undefined && json.code !== 200)) {
		const detail = json && json.message ? `：${json.message}` : "";
		const code = json && json.code !== undefined ? `（code=${json.code}）` : "";
		throw new Error(`${action}失败${code}${detail}`);
	}
	return json;
}

/* ------------------------------------------------------------------ *
 * 数据整理
 * ------------------------------------------------------------------ */

/** 统一歌曲结构 */
export function normalizeSong(raw) {
	if (!raw) {
		return null;
	}
	const album = raw.al || raw.album || {};
	const artists = raw.ar || raw.artists || [];
	return {
		id: String(raw.id),
		name: raw.name || "未知歌曲",
		artists: artists.map(item => item.name).filter(Boolean).join(" / ") || "未知歌手",
		album: album.name || "",
		cover: album.picUrl || "",
		duration: raw.dt || raw.duration || 0,
		fee: raw.fee ?? 0,
	};
}

/** 统一歌单结构 */
export function normalizePlaylist(raw) {
	if (!raw) {
		return null;
	}
	return {
		id: String(raw.id),
		name: raw.name || "未命名歌单",
		cover: raw.coverImgUrl || raw.picUrl || "",
		trackCount: raw.trackCount ?? 0,
		playCount: raw.playCount ?? 0,
		creator: (raw.creator && raw.creator.nickname) || "",
		description: raw.description || "",
	};
}

/* ------------------------------------------------------------------ *
 * 账号
 * ------------------------------------------------------------------ */

/** 获取登录状态 */
export async function fetchAccount() {
	const json = await weapiPost("/weapi/w/nuser/account/get", {});
	return {
		account: json.account || null,
		profile: json.profile || null,
	};
}

/** 用当前 Cookie 换取账号信息（并把 uid/昵称写入返回值） */
export async function fetchProfile() {
	const { profile } = await fetchAccount();
	if (!profile) {
		throw new Error("Cookie 无效或已过期，请重新登录");
	}
	return {
		uid: String(profile.userId),
		nickname: profile.nickname || "",
		avatar: profile.avatarUrl || "",
	};
}

/* ------------------------------------------------------------------ *
 * 歌单
 * ------------------------------------------------------------------ */

/** 歌单详情（自动补齐全部歌曲） */
export async function fetchPlaylistDetail(id) {
	const json = await weapiPost("/weapi/v6/playlist/detail", { id: String(id), n: 1000, s: 8 });
	ensure(json, "获取歌单");
	const playlist = json.playlist;
	let tracks = (playlist.tracks || []).map(normalizeSong).filter(Boolean);
	const orderedIds = (playlist.trackIds || []).map(item => String(item.id));
	if (orderedIds.length > tracks.length) {
		const known = new Set(tracks.map(track => track.id));
		const missing = orderedIds.filter(trackId => !known.has(trackId));
		if (missing.length) {
			const extra = await fetchSongs(missing);
			const map = new Map();
			for (const track of [...tracks, ...extra]) {
				map.set(track.id, track);
			}
			tracks = orderedIds.map(trackId => map.get(trackId)).filter(Boolean);
		}
	}
	return { info: normalizePlaylist(playlist), tracks };
}

/** 批量获取歌曲信息（每批 80 首：参数要放进查询串，避免 URL 过长） */
export async function fetchSongs(ids) {
	const result = [];
	for (let i = 0; i < ids.length; i += 80) {
		const chunk = ids.slice(i, i + 80);
		const json = await weapiPost("/weapi/v3/song/detail", {
			c: JSON.stringify(chunk.map(id => ({ id }))),
			ids: JSON.stringify(chunk),
		});
		if (json.songs) {
			result.push(...json.songs.map(normalizeSong).filter(Boolean));
		}
	}
	return result;
}

/** 用户歌单（我创建的和收藏的） */
export async function fetchUserPlaylists(uid) {
	const json = await weapiPost("/weapi/user/playlist", {
		uid: String(uid),
		limit: 1000,
		offset: 0,
		includeVideo: true,
	});
	ensure(json, "获取我的歌单");
	return (json.playlist || []).map(normalizePlaylist).filter(Boolean);
}

/** 推荐歌单 */
export async function fetchRecommendedPlaylists(limit = 12) {
	const json = await weapiPost("/weapi/personalized/playlist", { limit, total: true, n: 1000 });
	ensure(json, "获取推荐歌单");
	return (json.result || []).map(normalizePlaylist).filter(Boolean);
}

/** 排行榜列表 */
export async function fetchToplists() {
	const json = await weapiPost("/weapi/toplist", {});
	ensure(json, "获取排行榜");
	return (json.list || []).map(normalizePlaylist).filter(Boolean);
}

/** 搜索（type: 1 单曲 / 1000 歌单） */
export async function search(keyword, type = 1, limit = 30, offset = 0) {
	const json = await weapiPost("/weapi/search/get/web", {
		s: String(keyword),
		type,
		limit,
		offset,
	});
	ensure(json, "搜索");
	const result = json.result || {};
	if (Number(type) === 1000) {
		return {
			total: result.playlistCount ?? 0,
			playlists: (result.playlists || []).map(normalizePlaylist).filter(Boolean),
			songs: [],
		};
	}
	return {
		total: result.songCount ?? 0,
		songs: (result.songs || []).map(normalizeSong).filter(Boolean),
		playlists: [],
	};
}

/* ------------------------------------------------------------------ *
 * 播放地址与歌词
 * ------------------------------------------------------------------ */

const QUALITY_FALLBACK = ["exhigh", "higher", "standard"];

/**
 * 获取歌曲播放地址（按音质从高到低尝试，失败时退回外链）
 * @param {string} id
 * @param {string} quality
 */
export async function fetchSongUrl(id, quality = "exhigh") {
	const levels = [quality, ...QUALITY_FALLBACK].filter((item, index, array) => array.indexOf(item) === index);
	for (const level of levels) {
		const json = await weapiPost("/weapi/song/enhance/player/url/v1", {
			ids: `[${id}]`,
			level,
			encodeType: "mp3",
		});
		const data = json.data && json.data[0];
		if (data && data.url && data.code === 200) {
			return {
				// 网易云返回的直链是 http，安卓 WebView 里 https 页面加载 http 媒体会被拦，
				// 实测同一地址换成 https 一样可播（206 + audio/mpeg），所以统一升级成 https。
				url: String(data.url).replace(/^http:/i, "https:"),
				br: data.br || 128000,
				size: data.size || 0,
				fee: data.fee ?? 0,
				// 有 freeTrialInfo 说明只能试听片段
				trial: data.freeTrialInfo ? data.freeTrialInfo : null,
				level: data.level || level,
			};
		}
	}
	return {
		url: `${BASE_URL}/song/media/outer/url?id=${id}.mp3`,
		br: 128000,
		size: 0,
		fee: -1,
		trial: null,
		level: "outer",
	};
}

/** 歌词 */
export async function fetchLyric(id) {
	const json = await weapiPost("/weapi/song/lyric", { id: String(id), lv: -1, kv: -1, tv: -1 });
	return (json.lrc && json.lrc.lyric) || "";
}

/* ------------------------------------------------------------------ *
 * 扫码登录
 * ------------------------------------------------------------------ */

/** 申请二维码 key */
export async function createQrKey() {
	const json = await weapiPost("/weapi/login/qrcode/unikey", { type: 1 });
	ensure(json, "获取二维码");
	return json.unikey;
}

/**
 * 轮询扫码状态
 * code: 800 过期 / 801 等待扫码 / 802 待确认 / 803 成功
 */
export async function pollQrLogin(key) {
	const json = await weapiRaw("/weapi/login/qrcode/client/login", { key, type: 1 });
	return json;
}

/** 二维码内容 */
export function qrContent(key) {
	return `https://music.163.com/login?codekey=${key}`;
}

export const api = {
	setCookie,
	getCookie,
	isLoggedIn,
	fetchAccount,
	fetchProfile,
	fetchPlaylistDetail,
	fetchSongs,
	fetchUserPlaylists,
	fetchRecommendedPlaylists,
	fetchToplists,
	search,
	fetchSongUrl,
	fetchLyric,
	createQrKey,
	pollQrLogin,
	qrContent,
};
