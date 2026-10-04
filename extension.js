/**
 * 网易云音乐盒 - 扩展入口
 *
 * 扩展页面（游戏主菜单 → 扩展 → 网易云音乐盒）提供：
 *   · 音乐盒：打开播放面板，选择歌单/搜索/播放
 *   · 浏览器登录：调用系统默认浏览器打开网易云登录页
 *   · 扫码登录：在游戏内显示二维码，用手机网易云 App 扫码
 *   · 会话：粘贴浏览器 Cookie 以同步登录状态
 *   · 其余为播放相关选项
 */
import { lib } from "noname";
import { musicBox } from "./src/ui.js";
import { session, readConfig, writeConfig } from "./src/store.js";
import * as api from "./src/api.js";
import { EXT_NAME, LOGIN_URL, openExternal, parsePlaylistId } from "./src/util.js";

export const type = "extension";

/** 把扩展页面输入框里的内容还原成纯文本 */
function readInput(node) {
	return String((node && node.innerHTML) || "")
		.replace(/<br\s*\/?>/gi, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&amp;/gi, "&")
		.trim();
}

export default async function () {
	const config = {
		enable: {
			name: "开启",
			init: true,
		},
		musicbox: {
			name: "音乐盒",
			clear: true,
			intro: "打开网易云音乐盒：选择歌单、搜索歌曲、播放控制",
			onclick() {
				musicBox.open();
				return false;
			},
		},
		browserLogin: {
			name: "浏览器登录",
			clear: true,
			intro: "调用系统默认浏览器打开网易云登录页；登录后可回到「会话」粘贴 Cookie 同步账号",
			onclick() {
				const ok = openExternal(LOGIN_URL);
				musicBox.open("login");
				musicBox.toast(
					ok
						? "已调用系统浏览器打开网易云登录页；登录完成后请用「会话」项粘贴 Cookie"
						: "无法调用系统浏览器，请手动打开 music.163.com 登录",
					4200
				);
				return false;
			},
		},
		qrLogin: {
			name: "扫码登录",
			clear: true,
			intro: "在游戏内显示二维码，用手机网易云音乐 App 扫码登录（推荐）",
			onclick() {
				musicBox.open("login");
				musicBox.startQrLogin();
				return false;
			},
		},
		accountInfo: {
			name: "登录状态",
			clear: true,
			nopointer: true,
			intro: () => musicBox.loginSummary(),
		},
		nowPlaying: {
			name: "正在播放",
			clear: true,
			nopointer: true,
			intro: () => musicBox.playingSummary(),
			onclick() {
				musicBox.open();
				return false;
			},
		},
		cookie: {
			name: "会话",
			input: true,
			init: "",
			intro: "粘贴浏览器中的 Cookie（包含 MUSIC_U=…）以同步网易云登录状态",
			onblur() {
				const value = readInput(this);
				if (!value) {
					session.clear();
					api.setCookie("");
					musicBox.toast("已清除登录状态");
					return;
				}
				const cookie = value.includes("=") ? value : `MUSIC_U=${value}`;
				api.setCookie(cookie);
				session.cookie = cookie;
				musicBox.toast("已保存，正在验证登录状态…");
				api.fetchProfile()
					.then(profile => {
						session.uid = profile.uid;
						session.nickname = profile.nickname;
						session.avatar = profile.avatar;
						musicBox.toast(`登录成功：${profile.nickname}`);
					})
					.catch(error => {
						musicBox.toast(`验证失败：${error.message}`, 3600);
					});
			},
		},
		lastPlaylist: {
			name: "默认歌单",
			input: true,
			init: "",
			intro: "歌单 ID 或链接；开启「开局自动显示」后进入对局会自动打开这个歌单",
			onblur() {
				const value = readInput(this);
				writeConfig("lastPlaylist", parsePlaylistId(value) || value);
			},
		},
		autoOpen: {
			name: "开局自动显示",
			init: false,
			intro: "进入对局后自动打开音乐盒，并载入「默认歌单」",
		},
		autoResume: {
			name: "开机续播",
			init: true,
			intro: "开启后，每次打开游戏都会自动接着播放上次的歌曲与进度（关闭游戏时会记住播放位置）",
		},
		autoHide: {
			name: "小窗自动收起",
			input: true,
			init: "5",
			intro: "右下角小窗多少秒无操作后收起为圆形唱片（0 表示不收起），点击唱片可重新展开",
			onblur() {
				const value = Number(readInput(this));
				writeConfig("autoHide", Number.isFinite(value) && value > 0 ? value : 0);
			},
		},
		pauseBgm: {
			name: "暂停游戏BGM",
			init: true,
			intro: "播放网易云音乐时自动暂停无名杀的背景音乐",
			onclick(bool) {
				musicBox.applySetting("pauseBgm", bool);
			},
		},
		quality: {
			name: "音质",
			init: "exhigh",
			intro: "音质越高越容易被版权/VIP 限制，遇到无法播放会自动降级",
			item: {
				standard: "标准",
				higher: "较高",
				exhigh: "极高",
				lossless: "无损",
			},
			onclick(item) {
				musicBox.applySetting("quality", item);
			},
		},
		mode: {
			name: "播放模式",
			init: "order",
			item: {
				order: "顺序播放",
				loop: "列表循环",
				single: "单曲循环",
				shuffle: "随机播放",
			},
			onclick(item) {
				musicBox.applySetting("mode", item);
			},
		},
		volume: {
			name: "音量",
			input: true,
			init: "80",
			intro: "0 ~ 100",
			onblur() {
				musicBox.applySetting("volume", readInput(this));
			},
		},
		help: {
			name: "使用说明",
			clear: true,
			nopointer: true,
			onclick() {
				alert(
					`【网易云音乐盒】使用说明

1. 登录（任选其一）：
   · 扫码登录：推荐，用手机网易云音乐 App 扫描游戏内二维码；
   · 浏览器登录：点击后调用系统浏览器打开网易云登录页，登录完成后回到「会话」项粘贴 Cookie；
   · 弹出登录窗口：在独立窗口中登录，音乐盒会自动读取登录状态。

2. 选歌：打开「音乐盒」，左侧可选择我的歌单／推荐歌单／排行榜／搜索／歌单 ID。
   点击歌曲即可播放，播放时会自动暂停游戏背景音乐。

3. 播放控制：底部有上一首／播放暂停／下一首／播放模式、进度条与音量；
   也可以在对局中点击右上角「音乐」按钮随时呼出。

   右下角的悬浮小窗可以直接拖动到任意位置；无操作几秒后会自动收起成圆形唱片（点击唱片再展开）。

4. 开机续播：开启「开机续播」后，每次打开游戏都会自动接着上次的歌曲和进度继续播放；
   可以在扩展页面的「开机续播」里关闭，或把「小窗自动收起」设为 0 让它一直保持完整小窗。

5. 说明：未登录时可以听推荐歌单、排行榜里的免费歌曲；
   VIP 歌曲未登录时只能试听 45 秒片段，登录会员账号后可完整播放。`
				);
				return false;
			},
		},
	};

	return {
		name: EXT_NAME,
		editable: false,
		config,
		package: {
			intro: "在无名杀里听网易云音乐：扩展页面一键调用系统浏览器登录网易云账号，也可扫码登录；支持我的歌单、推荐歌单、排行榜、搜索与歌单 ID，随时选歌播放。游戏内重新开始/重来也不会打断播放。",
			author: "shibaiderman096",
			diskURL: "https://github.com/libnoname/noname",
			forumURL: "https://github.com/shibaiderman096/noname-netease-musicbox",
			version: "1.1.0",
			nopack: true,
		},
		precontent(data) {
			// 恢复上次的登录状态
			if (data && data.cookie) {
				api.setCookie(data.cookie);
			}
			// 游戏「重新开始」会重载页面；若音频输出窗口还在播放，自动把控制界面恢复出来
			// 否则按「开机续播」设置，接着上次的记录播放
			setTimeout(() => {
				try {
					musicBox.bootstrap();
				} catch (e) {
					console.warn(`[${EXT_NAME}] 恢复音乐盒状态失败`, e);
				}
			}, 1200);
			// 进入对局后自动显示音乐盒
			if (data && data.autoOpen) {
				const openAfterArena = () => {
					setTimeout(() => {
						try {
							musicBox.open();
							const playlist = readConfig("lastPlaylist");
							if (playlist) {
								musicBox.openPlaylistById(playlist);
								musicBox.toast("已载入默认歌单，点击歌曲即可播放", 3200);
							}
						} catch (e) {
							console.warn(`[${EXT_NAME}] 自动打开音乐盒失败`, e);
						}
					}, 900);
				};
				if (Array.isArray(lib.arenaReady)) {
					lib.arenaReady.push(openAfterArena);
				}
			}
		},
		content() {
			// 对局内按钮统一在 arenaReady 中创建（此时 ui.system1/system2 已存在）
		},
		arenaReady() {
			musicBox.attachGameButton();
		},
		onremove() {
			try {
				musicBox.closeOutput();
				musicBox.close();
			} catch (e) {}
		},
	};
}
