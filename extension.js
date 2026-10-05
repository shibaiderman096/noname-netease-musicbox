/**
 * 网易云音乐盒 - 扩展入口
 *
 * 扩展页面（游戏主菜单 → 扩展 → 网易云音乐盒）只保留必要入口：
 *   · 音乐盒：打开播放/登录面板（歌单、搜索、账号登录都在面板里）
 *   · 检查更新：对比 GitHub 上的最新版本
 *   · 跳转仓库：用系统浏览器打开项目主页
 *   · 功能开关：开机续播 / 暂停游戏BGM / 开局自动显示 / 小窗自动收起
 *   · 使用说明
 */
import { lib } from "noname";
import { musicBox } from "./src/ui.js";
import * as api from "./src/api.js";
import { readConfig, writeConfig } from "./src/store.js";
import { EXT_NAME, openExternal } from "./src/util.js";
import { checkUpdate, REPO_URL } from "./src/update.js";

export const type = "extension";

/** 当前版本（与 info.json 保持一致） */
const VERSION = "1.4.1";

export default async function () {
	const config = {
		enable: {
			name: "开启",
			init: true,
		},
		musicbox: {
			name: "音乐盒",
			clear: true,
			intro: "打开网易云音乐盒：选歌单、搜索歌曲、播放控制，以及账号登录（浏览器登录 / 扫码登录 / 粘贴 Cookie）",
			onclick() {
				musicBox.open();
				return false;
			},
		},
		checkUpdate: {
			name: "检查更新",
			clear: true,
			intro: "对比 GitHub 上的最新版本，有新版本可以直接打开下载页",
			onclick() {
				musicBox.toast("正在检查更新…", 1600);
				checkUpdate(VERSION)
					.then(result => {
						if (!result.hasUpdate) {
							musicBox.toast(`已是最新版本 v${result.current}`, 2800);
							return;
						}
						const go = confirm(`发现新版本 v${result.latest}（当前 v${result.current}）\n\n是否打开下载页面？\n${result.url}`);
						if (go) {
							openExternal(result.url);
						}
					})
					.catch(error => {
						musicBox.toast(`检查更新失败：${error.message}`, 3600);
					});
				return false;
			},
		},
		repo: {
			name: "跳转仓库",
			clear: true,
			intro: "用系统默认浏览器打开扩展仓库（Releases 里可以下载安装包）",
			onclick() {
				const ok = openExternal(REPO_URL);
				musicBox.toast(ok ? "已用系统浏览器打开仓库页面" : `请手动访问 ${REPO_URL}`, 3200);
				return false;
			},
		},
		autoResume: {
			name: "开机续播",
			init: true,
			intro: "每次打开游戏都自动接着上次的歌曲与进度播放（关闭游戏时会记住播放位置）",
		},
		pauseBgm: {
			name: "暂停游戏BGM",
			init: true,
			intro: "播放网易云音乐时自动暂停无名杀的背景音乐",
			onclick(bool) {
				musicBox.applySetting("pauseBgm", bool);
			},
		},
		autoOpen: {
			name: "开局自动显示",
			init: false,
			intro: "进入对局后自动打开音乐盒，并载入上次播放的歌单",
		},
		autoHideToggle: {
			name: "小窗自动收起",
			init: true,
			intro: "右下角小窗无操作 5 秒后收成圆形唱片，点击唱片即可重新展开；关掉则一直保持完整小窗",
			onclick(bool) {
				writeConfig("autoHideToggle", bool);
				writeConfig("autoHide", bool ? 5 : 0);
			},
		},
		help: {
			name: "使用说明",
			clear: true,
			nopointer: true,
			onclick() {
				alert(
					`【网易云音乐盒 v${VERSION}】使用说明

1. 打开音乐盒：点扩展页面的「音乐盒」，或对局中点右上角「音乐」按钮。
   右下角还有悬浮小窗（可拖动、可收成圆盘、点圆盘展开），随时控制播放。

2. 登录（在音乐盒面板的「账号与登录」里，任选其一）：
   · 浏览器登录：用系统浏览器打开网易云登录页，登录后把 Cookie 粘到「会话」里；
   · 扫码登录：推荐，用手机网易云音乐 App 扫描游戏内二维码；
   · 弹出登录窗口：在独立窗口中登录，音乐盒会自动读取登录状态。

3. 选歌：面板左侧可选我的歌单／推荐歌单／排行榜／搜索／歌单 ID 与链接／常用歌单。
   点击歌曲即可播放，播放时会自动暂停游戏背景音乐。

4. 功能开关（本页面）：
   · 开机续播：每次打开游戏自动接着上次的歌曲与进度播放；
   · 暂停游戏BGM：播放网易云音乐时暂停无名杀背景音乐；
   · 开局自动显示：进入对局后自动打开音乐盒；
   · 小窗自动收起：右下角小窗无操作 5 秒后收成圆形唱片。

5. 说明：未登录时可以听推荐歌单、排行榜里的免费歌曲；
   VIP 歌曲未登录时只能试听 45 秒片段，登录会员账号后可完整播放。
   游戏内「重新开始 / 重来」不会打断播放，界面会自动恢复。`
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
			intro: "在无名杀里听网易云音乐：打开音乐盒即可调用系统浏览器登录网易云账号或扫码登录，支持我的歌单、推荐歌单、排行榜、搜索与歌单 ID，随时选歌播放。游戏内重新开始/重来也不会打断播放。",
			author: "shibaiderman096",
			diskURL: "https://github.com/libnoname/noname",
			forumURL: REPO_URL,
			version: VERSION,
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
							const playlist = readConfig("lastPlaylist") || musicBox.currentPlaylistId();
							if (playlist) {
								musicBox.openPlaylistById(playlist);
							}
							musicBox.toast("已打开音乐盒", 2600);
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
