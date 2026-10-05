/**
 * 网易云音乐盒 - 配置与会话存储
 *
 * 全部通过无名杀的 lib.config / game.saveConfig 持久化，
 * 键名统一为 extension_网易云音乐盒_xxx（与扩展页面的选项同名）。
 */
import { lib, game } from "noname";
import { CONFIG_PREFIX, EXT_NAME } from "./util.js";

const DEFAULTS = {
	cookie: "",
	uid: "",
	nickname: "",
	avatar: "",
	lastPlaylist: "",
	lastPlaylistName: "",
	favorites: "[]",
	volume: 0.8,
	mode: "order",
	quality: "exhigh",
	pauseBgm: true,
	autoOpen: false,
	autoResume: true,
	autoHide: 5,
	miniPos: "",
	panelPos: "",
	netBackend: "",
};

/** 读取配置（带默认值） */
export function readConfig(key) {
	try {
		const full = CONFIG_PREFIX + key;
		const value = lib?.config?.[full];
		if (value === undefined || value === null || value === "") {
			return DEFAULTS[key];
		}
		return value;
	} catch (e) {
		return DEFAULTS[key];
	}
}

/** 写入配置 */
export function writeConfig(key, value) {
	try {
		game.saveConfig(CONFIG_PREFIX + key, value);
	} catch (e) {
		console.warn(`[${EXT_NAME}] 保存配置失败`, e);
	}
}

/** 会话（Cookie / 账号） */
export const session = {
	get cookie() {
		return String(readConfig("cookie") || "");
	},
	set cookie(value) {
		writeConfig("cookie", String(value || ""));
	},
	get uid() {
		return String(readConfig("uid") || "");
	},
	set uid(value) {
		writeConfig("uid", String(value || ""));
	},
	get nickname() {
		return String(readConfig("nickname") || "");
	},
	set nickname(value) {
		writeConfig("nickname", String(value || ""));
	},
	get avatar() {
		return String(readConfig("avatar") || "");
	},
	set avatar(value) {
		writeConfig("avatar", String(value || ""));
	},
	get logged() {
		return !!this.cookie && !!this.uid;
	},
	/** 清空登录状态 */
	clear() {
		this.cookie = "";
		this.uid = "";
		this.nickname = "";
		this.avatar = "";
	},
	/** 收藏歌单列表 */
	get favorites() {
		try {
			const parsed = JSON.parse(readConfig("favorites") || "[]");
			return Array.isArray(parsed) ? parsed : [];
		} catch (e) {
			return [];
		}
	},
	set favorites(list) {
		writeConfig("favorites", JSON.stringify(Array.isArray(list) ? list : []));
	},
};

/** 面板位置等界面状态 */
export const viewState = {
	get panelPos() {
		try {
			return JSON.parse(readConfig("panelPos") || "null") || null;
		} catch (e) {
			return null;
		}
	},
	set panelPos(pos) {
		writeConfig("panelPos", JSON.stringify(pos || null));
	},
};
