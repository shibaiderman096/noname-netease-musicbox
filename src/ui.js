/**
 * 网易云音乐盒 - 界面
 *
 * 面板与游戏内小播放条都直接挂在 document.body 上，
 * 因此菜单界面与对局中都能使用。
 */
import { ui } from "noname";
import * as api from "./api.js";
import { session, readConfig, writeConfig, viewState } from "./store.js";
import { Player, MODE_LABELS, hasRunningOutput } from "./player.js";
import { MUSIC_BOX_CSS } from "./style.js";
import { qrEncode } from "./qrcode.js";
import { EXT_NAME, LOGIN_URL, openExternal, escapeHtml, formatTime, formatCount, parsePlaylistId, getRequire } from "./util.js";

let installed = false;
let player = null;
let root = null;
let panel = null;
let mini = null;
let toastNode = null;
let toastTimer = null;

const dom = {};
const state = {
	view: "recommend",
	loading: false,
	error: "",
	playlists: [],
	songs: [],
	songTitle: "",
	searchKeyword: "",
	searchType: 1,
	lastQuery: "",
	qrKey: "",
	qrTimer: null,
	seeking: false,
};

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/** 轻量提示 */
export function toast(text, duration = 2600) {
	if (!installed) {
		install();
	}
	toastNode.innerHTML = String(text);
	toastNode.classList.add("nmb-show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastNode.classList.remove("nmb-show"), duration);
}

function escapeAttr(text) {
	return escapeHtml(text);
}

function setLoading(loading) {
	state.loading = loading;
	renderList();
}

/** 统一处理异步操作 */
async function run(action, errorPrefix) {
	setLoading(true);
	state.error = "";
	try {
		await action();
	} catch (e) {
		state.error = `${errorPrefix || "操作"}失败：${e && e.message ? e.message : e}`;
	} finally {
		setLoading(false);
	}
}

/* ------------------------------------------------------------------ *
 * 安装
 * ------------------------------------------------------------------ */

export function install() {
	if (installed) {
		return;
	}
	installed = true;

	const style = document.createElement("style");
	style.id = "nmb-style";
	style.textContent = MUSIC_BOX_CSS;
	document.head.appendChild(style);

	root = document.createElement("div");
	root.id = "nmb-root";
	root.innerHTML = `
		<div class="nmb-mask"></div>
		<div class="nmb-panel">
			<div class="nmb-head" id="nmb-drag">
				<span class="nmb-logo">🎵</span>
				<span class="nmb-title">网易云音乐盒</span>
				<span class="nmb-account" id="nmb-account">未登录</span>
				<span class="nmb-spacer"></span>
				<button class="nmb-btn nmb-icon" data-act="login" title="账号与登录">👤</button>
				<button class="nmb-btn nmb-icon" data-act="mini" title="收起为小窗">—</button>
				<button class="nmb-btn nmb-icon" data-act="close" title="关闭">✕</button>
			</div>
			<div class="nmb-body">
				<div class="nmb-side" id="nmb-side">
					<button class="nmb-sidebtn" data-src="mine">我的歌单</button>
					<button class="nmb-sidebtn" data-src="recommend">推荐歌单</button>
					<button class="nmb-sidebtn" data-src="top">排行榜</button>
					<button class="nmb-sidebtn" data-src="search">搜索歌曲</button>
					<button class="nmb-sidebtn" data-src="id">歌单 ID / 链接</button>
					<button class="nmb-sidebtn" data-src="fav">常用歌单</button>
					<button class="nmb-sidebtn" data-src="login">账号与登录</button>
					<div class="nmb-sidetip">点击歌曲即可播放<br>播放时会自动暂停游戏背景音乐</div>
				</div>
				<div class="nmb-main">
					<div class="nmb-toolbar" id="nmb-toolbar"></div>
					<div class="nmb-list" id="nmb-list"></div>
				</div>
			</div>
			<div class="nmb-foot">
				<div class="nmb-cover" id="nmb-cover"></div>
				<div class="nmb-meta">
					<div class="nmb-song" id="nmb-song">未在播放</div>
					<div class="nmb-artist" id="nmb-artist"></div>
				</div>
				<div class="nmb-ctrl">
					<button class="nmb-btn" data-act="prev" title="上一首">⏮</button>
					<button class="nmb-btn nmb-play" data-act="toggle" title="播放/暂停">▶</button>
					<button class="nmb-btn" data-act="next" title="下一首">⏭</button>
					<button class="nmb-btn" data-act="mode" id="nmb-mode" title="播放模式">🔁</button>
				</div>
				<div class="nmb-progress">
					<span id="nmb-time">00:00</span>
					<input type="range" id="nmb-seek" min="0" max="1000" value="0">
					<span id="nmb-duration">00:00</span>
				</div>
				<div class="nmb-vol">
					<span id="nmb-volicon">🔊</span>
					<input type="range" id="nmb-volume" min="0" max="100" value="80">
				</div>
			</div>
			<div class="nmb-tip" id="nmb-tip"></div>
		</div>`;
	document.body.appendChild(root);

	mini = document.createElement("div");
	mini.id = "nmb-mini";
	mini.innerHTML = `
		<div class="nmb-mini-cover" id="nmb-mini-cover"></div>
		<div class="nmb-mini-text" id="nmb-mini-text">未在播放</div>
		<button class="nmb-btn" data-act="prev" title="上一首">⏮</button>
		<button class="nmb-btn" data-act="toggle" id="nmb-mini-toggle" title="播放/暂停">▶</button>
		<button class="nmb-btn" data-act="next" title="下一首">⏭</button>
		<button class="nmb-btn" data-act="open" title="展开音乐盒">🔍</button>`;
	document.body.appendChild(mini);

	toastNode = document.createElement("div");
	toastNode.id = "nmb-toast";
	document.body.appendChild(toastNode);

	dom.panel = root.querySelector(".nmb-panel");
	dom.account = root.querySelector("#nmb-account");
	dom.side = root.querySelector("#nmb-side");
	dom.toolbar = root.querySelector("#nmb-toolbar");
	dom.list = root.querySelector("#nmb-list");
	dom.cover = root.querySelector("#nmb-cover");
	dom.song = root.querySelector("#nmb-song");
	dom.artist = root.querySelector("#nmb-artist");
	dom.time = root.querySelector("#nmb-time");
	dom.duration = root.querySelector("#nmb-duration");
	dom.seek = root.querySelector("#nmb-seek");
	dom.volume = root.querySelector("#nmb-volume");
	dom.volicon = root.querySelector("#nmb-volicon");
	dom.mode = root.querySelector("#nmb-mode");
	dom.miniText = mini.querySelector("#nmb-mini-text");
	dom.miniCover = mini.querySelector("#nmb-mini-cover");
	dom.miniToggle = mini.querySelector("#nmb-mini-toggle");
	dom.playButtons = Array.from(root.querySelectorAll('[data-act="toggle"]'));

	// 播放器
	const savedVolume = Number(readConfig("volume"));
	const volume = Number.isFinite(savedVolume) && savedVolume > 0 ? (savedVolume > 1 ? savedVolume / 100 : savedVolume) : 0.8;
	player = new Player({
		volume,
		mode: readConfig("mode") || "order",
		quality: readConfig("quality") || "exhigh",
		pauseGameBgm: readConfig("pauseBgm") !== false,
		bgmProvider: () => ui && ui.backgroundMusic,
	});
	api.setCookie(session.cookie);
	dom.volume.value = String(Math.round(player.volume * 100));
	updateModeButton();
	bindPlayerEvents();
	bindDomEvents();
	restorePanelPosition();
	renderSide();
	setView(state.view, true);

	// 恢复上次的播放状态（游戏「重新开始」重载页面后，音乐仍在独立窗口里继续）
	player
		.refresh()
		.then(() => restorePlayback())
		.catch(() => restorePlayback());

	// 会话恢复后刷新账号信息
	if (session.cookie) {
		refreshAccount(true).catch(() => {});
	}
}

/** 用播放器里的状态恢复界面（底栏、小窗、歌曲列表） */
function restorePlayback() {
	const tracks = player.tracks;
	if (tracks && tracks.length) {
		state.songs = tracks;
		state.songTitle = player.playlistTitle || "播放列表";
		state.currentPlaylist = { id: player.playlistId, name: state.songTitle };
		if (state.view !== "login" && state.view !== "search" && state.view !== "id") {
			state.view = "songs";
			renderSide();
			renderToolbar();
		}
		if (typeof player.index === "number" && player.index >= 0) {
			state.seekIndex = player.index;
		}
	} else {
		state.songs = state.songs || [];
	}
	const track = player.current;
	if (track) {
		updateTrackDom(track);
	}
	renderList();
	// 正在播放时把控制条状态和小窗补上
	player.emit("volume", player.volume);
	player.emit("mode", player.mode);
	if (player.playing) {
		player.emit("play");
		player.emit("duration", player.duration);
		player.emit("time", player.currentTime);
	} else {
		player.emit("pause");
	}
}

/* ------------------------------------------------------------------ *
 * 事件绑定
 * ------------------------------------------------------------------ */

function updateTrackDom(track) {
	if (!track) {
		dom.song.textContent = "未在播放";
		dom.artist.textContent = "";
		dom.cover.style.backgroundImage = "";
		dom.miniText.textContent = "未在播放";
		dom.miniCover.style.backgroundImage = "";
		renderList();
		return;
	}
	dom.song.textContent = track.name;
	dom.song.title = track.name;
	dom.artist.textContent = `${track.artists}${track.album ? ` · ${track.album}` : ""}`;
	dom.cover.style.backgroundImage = track.cover ? `url("${track.cover}")` : "";
	dom.miniText.textContent = `${track.name} - ${track.artists}`;
	dom.miniCover.style.backgroundImage = track.cover ? `url("${track.cover}")` : "";
	dom.miniText.title = dom.miniText.textContent;
	renderList();
}

function bindPlayerEvents() {
	player.on("track", track => updateTrackDom(track));
	player.on("play", () => {
		for (const button of dom.playButtons) {
			button.textContent = "⏸";
		}
		dom.miniToggle.textContent = "⏸";
		mini.classList.add("nmb-show");
	});
	player.on("pause", () => {
		for (const button of dom.playButtons) {
			button.textContent = "▶";
		}
		dom.miniToggle.textContent = "▶";
	});
	player.on("time", ms => {
		if (state.seeking) {
			return;
		}
		dom.time.textContent = formatTime(ms);
		const duration = player.duration;
		if (duration > 0) {
			dom.seek.value = String(Math.round((ms / duration) * 1000));
		}
	});
	player.on("duration", ms => {
		dom.duration.textContent = formatTime(ms);
	});
	player.on("volume", volume => {
		dom.volume.value = String(Math.round(volume * 100));
		dom.volicon.textContent = volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊";
	});
	player.on("mode", () => updateModeButton());
	player.on("trial", trial => {
		if (trial) {
			toast("这首歌只能试听片段，登录会员账号后可完整播放", 3200);
		}
	});
	player.on("error", error => {
		if (error && error.message) {
			toast(error.message, 2600);
		}
	});
	player.on("finished", () => {
		dom.miniToggle.textContent = "▶";
		for (const button of dom.playButtons) {
			button.textContent = "▶";
		}
	});
}

function bindDomEvents() {
	// 顶部按钮
	root.querySelector(".nmb-head").addEventListener("click", event => {
		const button = event.target.closest("[data-act]");
		if (!button) {
			return;
		}
		const action = button.dataset.act;
		if (action === "close") {
			close();
		} else if (action === "mini") {
			close();
		} else if (action === "login") {
			setView("login");
		}
	});
	root.querySelector(".nmb-mask").addEventListener("click", () => close());

	// 侧栏
	dom.side.addEventListener("click", event => {
		const button = event.target.closest("[data-src]");
		if (button) {
			setView(button.dataset.src);
		}
	});

	// 播放控制
	root.querySelector(".nmb-foot").addEventListener("click", event => {
		const button = event.target.closest("[data-act]");
		if (!button) {
			return;
		}
		const action = button.dataset.act;
		if (action === "prev") {
			player.prev();
		} else if (action === "next") {
			player.next(false);
		} else if (action === "toggle") {
			player.toggle();
		} else if (action === "mode") {
			const mode = player.nextMode();
			writeConfig("mode", mode);
			toast(MODE_LABELS[mode], 1200);
		}
	});

	// 迷你条
	mini.addEventListener("click", event => {
		const button = event.target.closest("[data-act]");
		if (!button) {
			return;
		}
		const action = button.dataset.act;
		if (action === "prev") {
			player.prev();
		} else if (action === "next") {
			player.next(false);
		} else if (action === "toggle") {
			player.toggle();
		} else if (action === "open") {
			open();
		}
	});

	// 进度条
	dom.seek.addEventListener("input", () => {
		state.seeking = true;
		const duration = player.duration;
		dom.time.textContent = formatTime((Number(dom.seek.value) / 1000) * duration);
	});
	dom.seek.addEventListener("change", () => {
		player.seek(Number(dom.seek.value) / 1000);
		state.seeking = false;
	});

	// 音量
	dom.volume.addEventListener("input", () => {
		const volume = player.setVolume(Number(dom.volume.value) / 100);
		writeConfig("volume", volume);
	});

	// 列表 / 工具栏 事件委托
	dom.list.addEventListener("click", onListClick);
	dom.toolbar.addEventListener("click", onToolbarClick);
	dom.toolbar.addEventListener("keydown", event => {
		if (event.key === "Enter" && event.target.dataset.role === "search") {
			state.searchKeyword = event.target.value.trim();
			doSearch(0);
		} else if (event.key === "Enter" && event.target.dataset.role === "playlist-id") {
			openPlaylistById(event.target.value);
		}
	});

	// 拖拽
	enableDrag();
}

/** 面板拖拽 */
function enableDrag() {
	const head = root.querySelector("#nmb-drag");
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let originLeft = 0;
	let originTop = 0;

	const onMove = event => {
		if (!dragging) {
			return;
		}
		const left = originLeft + (event.clientX - startX);
		const top = originTop + (event.clientY - startY);
		const maxLeft = window.innerWidth - 80;
		const maxTop = window.innerHeight - 40;
		dom.panel.style.left = `${Math.min(Math.max(left, -dom.panel.offsetWidth + 80), maxLeft)}px`;
		dom.panel.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
	};
	const onUp = () => {
		if (!dragging) {
			return;
		}
		dragging = false;
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		viewState.panelPos = { left: dom.panel.style.left, top: dom.panel.style.top };
	};

	head.addEventListener("mousedown", event => {
		if (event.target.closest("button")) {
			return;
		}
		dragging = true;
		startX = event.clientX;
		startY = event.clientY;
		const rect = dom.panel.getBoundingClientRect();
		originLeft = rect.left;
		originTop = rect.top;
		dom.panel.classList.add("nmb-dragged");
		dom.panel.style.left = `${rect.left}px`;
		dom.panel.style.top = `${rect.top}px`;
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
		event.preventDefault();
	});
}

function restorePanelPosition() {
	const pos = viewState.panelPos;
	if (pos && pos.left && pos.top) {
		dom.panel.classList.add("nmb-dragged");
		dom.panel.style.left = pos.left;
		dom.panel.style.top = pos.top;
	}
}

/* ------------------------------------------------------------------ *
 * 面板开关
 * ------------------------------------------------------------------ */

export function open(view) {
	if (!installed) {
		install();
	}
	root.classList.add("nmb-open");
	mini.classList.remove("nmb-show");
	if (view) {
		setView(view);
	} else {
		renderSide();
		renderToolbar();
		renderList();
		if (needLoad()) {
			setView(state.view);
		}
	}
	refreshAccount(true);
}

/** 当前分类还没有数据时，打开面板才去加载 */
function needLoad() {
	if (state.loading || state.error) {
		return false;
	}
	if (["mine", "recommend", "top", "fav"].includes(state.view)) {
		return !state.playlists.length;
	}
	return false;
}

export function close() {
	if (!installed) {
		return;
	}
	root.classList.remove("nmb-open");
	if (player && !player.playing && !player.hasSource) {
		mini.classList.remove("nmb-show");
	} else if (player) {
		mini.classList.add("nmb-show");
	}
	stopQrPolling();
}

export function toggle() {
	if (!installed) {
		install();
		open();
		return;
	}
	if (root.classList.contains("nmb-open")) {
		close();
	} else {
		open();
	}
}

/**
 * 页面重载后的自动接管：
 * 如果音频输出窗口还在（音乐没断），就把控制界面恢复出来（右下角小窗 + 底栏状态）。
 */
export function autoAttach() {
	if (installed) {
		return;
	}
	if (typeof document === "undefined" || !document.body) {
		setTimeout(autoAttach, 500);
		return;
	}
	if (!hasRunningOutput()) {
		return;
	}
	install();
}

/** 关闭音频输出窗口（删除扩展时调用） */
export function closeOutput() {
	if (player) {
		try {
			player.closeOutput();
		} catch (e) {}
	}
}

/** 兼容旧入口名 */
export function openMusicBox(view) {
	open(view);
}

/* ------------------------------------------------------------------ *
 * 视图切换
 * ------------------------------------------------------------------ */

function setView(view, silent) {
	state.view = view;
	state.error = "";
	renderSide();
	renderToolbar();
	renderList();
	if (silent) {
		return;
	}
	stopQrPolling();
	switch (view) {
		case "mine":
			loadMyPlaylists();
			break;
		case "recommend":
			loadRecommended();
			break;
		case "top":
			loadToplists();
			break;
		case "fav":
			renderFavorites();
			break;
		case "login":
			renderLogin();
			break;
		case "search":
		case "id":
			break;
		default:
			break;
	}
}

function renderSide() {
	for (const button of dom.side.querySelectorAll("[data-src]")) {
		button.classList.toggle("nmb-active", button.dataset.src === state.view);
	}
}

function updateModeButton() {
	const labels = { order: "➡", loop: "🔁", single: "🔂", shuffle: "🔀" };
	dom.mode.textContent = labels[player.mode] || "🔁";
	dom.mode.title = MODE_LABELS[player.mode] || "播放模式";
}

/* ------------------------------------------------------------------ *
 * 数据加载
 * ------------------------------------------------------------------ */

async function loadMyPlaylists() {
	if (!session.cookie) {
		state.playlists = [];
		state.songs = [];
		renderList();
		return;
	}
	await run(async () => {
		const uid = session.uid || (await ensureProfile()).uid;
		state.playlists = await api.fetchUserPlaylists(uid);
		state.songTitle = "我的歌单";
		state.view = "mine";
		renderSide();
		renderToolbar();
	}, "获取我的歌单");
}

async function loadRecommended() {
	await run(async () => {
		state.playlists = await api.fetchRecommendedPlaylists(18);
		state.songTitle = "推荐歌单";
	}, "获取推荐歌单");
}

async function loadToplists() {
	await run(async () => {
		state.playlists = await api.fetchToplists();
		state.songTitle = "排行榜";
	}, "获取排行榜");
}

async function doSearch(offset = 0) {
	const keyword = state.searchKeyword || state.lastQuery;
	if (!keyword) {
		toast("请输入搜索内容");
		return;
	}
	state.lastQuery = keyword;
	await run(async () => {
		const result = await api.search(keyword, state.searchType, 50, offset);
		if (state.searchType === 1000) {
			state.playlists = result.playlists;
			state.songs = [];
		} else {
			state.songs = result.songs;
			state.playlists = [];
			state.songTitle = `搜索：${keyword}`;
		}
	}, "搜索");
}

/** 打开歌单 */
async function openPlaylist(id, name) {
	const playlistId = String(id);
	if (!playlistId) {
		return;
	}
	await run(async () => {
		const detail = await api.fetchPlaylistDetail(playlistId);
		state.songs = detail.tracks;
		state.songTitle = detail.info.name || name || "歌单";
		state.currentPlaylist = detail.info;
		state.view = "songs";
		writeConfig("lastPlaylist", playlistId);
		writeConfig("lastPlaylistName", state.songTitle);
		renderSide();
		renderToolbar();
	}, "打开歌单");
}

function openPlaylistById(input) {
	const id = parsePlaylistId(input);
	if (!id) {
		toast("无法识别歌单 ID，请检查输入");
		return;
	}
	openPlaylist(id);
}

/* ------------------------------------------------------------------ *
 * 渲染：工具栏
 * ------------------------------------------------------------------ */

function renderToolbar() {
	const view = state.view;
	if (view === "search") {
		dom.toolbar.innerHTML = `
			<span class="nmb-title2">搜索</span>
			<button class="nmb-btn ${state.searchType === 1 ? "nmb-active" : ""}" data-tool="type" data-type="1">单曲</button>
			<button class="nmb-btn ${state.searchType === 1000 ? "nmb-active" : ""}" data-tool="type" data-type="1000">歌单</button>
			<input class="nmb-input nmb-grow" data-role="search" placeholder="输入歌名 / 歌手 / 歌单名，回车搜索" value="${escapeAttr(state.lastQuery)}">
			<button class="nmb-btn nmb-primary" data-tool="search">搜索</button>`;
		return;
	}
	if (view === "id") {
		dom.toolbar.innerHTML = `
			<span class="nmb-title2">歌单 ID / 链接</span>
			<input class="nmb-input nmb-grow" data-role="playlist-id" placeholder="粘贴歌单链接或输入歌单 ID，回车打开" value="">
			<button class="nmb-btn nmb-primary" data-tool="open-id">打开歌单</button>`;
		return;
	}
	if (view === "songs") {
		dom.toolbar.innerHTML = `
			<button class="nmb-btn" data-tool="back">← 返回</button>
			<span class="nmb-title2">${escapeHtml(state.songTitle || "歌单")}</span>
			<span class="nmb-sub">${state.songs.length} 首</span>
			<button class="nmb-btn nmb-primary" data-tool="play-all">播放全部</button>
			<button class="nmb-btn" data-tool="shuffle-all">随机播放</button>
			<button class="nmb-btn" data-tool="fav-add">☆ 常用</button>`;
		return;
	}
	if (view === "login") {
		dom.toolbar.innerHTML = `<span class="nmb-title2">账号与登录</span><span class="nmb-sub">登录后可查看自己的歌单与完整播放</span>`;
		return;
	}
	const titles = { mine: "我的歌单", recommend: "推荐歌单", top: "排行榜", fav: "常用歌单" };
	dom.toolbar.innerHTML = `
		<span class="nmb-title2">${titles[view] || ""}</span>
		<span class="nmb-sub">共 ${state.playlists.length} 个歌单</span>
		<button class="nmb-btn" data-tool="refresh">刷新</button>`;
}

/* ------------------------------------------------------------------ *
 * 渲染：列表
 * ------------------------------------------------------------------ */

function renderList() {
	const view = state.view;
	if (view === "login") {
		renderLogin();
		return;
	}
	if (state.loading) {
		dom.list.innerHTML = `<div class="nmb-loading">加载中…</div>`;
		return;
	}
	if (state.error) {
		dom.list.innerHTML = `<div class="nmb-empty">${escapeHtml(state.error)}<br><br>可以点击侧栏其它分类重试。</div>`;
		return;
	}
	if (view === "search" && state.searchType === 1000) {
		renderPlaylists(state.playlists, "没有搜索到歌单");
		return;
	}
	if (view === "search" || view === "songs") {
		renderSongs();
		return;
	}
	if (view === "id") {
		dom.list.innerHTML = `<div class="nmb-empty">输入或粘贴歌单链接、歌单 ID 后回车即可打开。<br>例如：https://music.163.com/#/playlist?id=3778678</div>`;
		return;
	}
	renderPlaylists(state.playlists, view === "mine" && !session.cookie ? "还没有登录，无法读取我的歌单。<br>请先到「账号与登录」登录。" : "暂无内容");
}

function renderPlaylists(playlists, emptyText) {
	if (!playlists || !playlists.length) {
		dom.list.innerHTML = `<div class="nmb-empty">${emptyText || "暂无内容"}</div>`;
		return;
	}
	dom.list.innerHTML = playlists
		.map(
			item => `
		<div class="nmb-card" data-playlist="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">
			<img src="${escapeAttr(item.cover)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.visibility='hidden'">
			<div class="nmb-cardinfo">
				<div class="nmb-cardname">${escapeHtml(item.name)}</div>
				<div class="nmb-cardmeta">${item.trackCount} 首${item.playCount ? ` · 播放 ${formatCount(item.playCount)}` : ""}${item.creator ? ` · by ${escapeHtml(item.creator)}` : ""}</div>
			</div>
			<div class="nmb-cardopt">
				<button class="nmb-btn" data-playlist-play="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">▶ 播放</button>
			</div>
		</div>`
		)
		.join("");
}

function renderSongs() {
	if (!state.songs.length) {
		dom.list.innerHTML = `<div class="nmb-empty">没有歌曲</div>`;
		return;
	}
	const currentId = player.current && player.current.id;
	dom.list.innerHTML = state.songs
		.map((track, index) => {
			const trial = track.fee === 1 || track.fee === 4 ? '<span class="nmb-tag">VIP</span>' : "";
			return `
		<div class="nmb-item ${track.id === currentId ? "nmb-current" : ""}" data-song="${index}">
			<span class="nmb-index">${index + 1}</span>
			<span class="nmb-name">${escapeHtml(track.name)}${trial}</span>
			<span class="nmb-artist2">${escapeHtml(track.artists)}</span>
			<span class="nmb-album">${escapeHtml(track.album)}</span>
			<span class="nmb-duration">${formatTime(track.duration)}</span>
		</div>`;
		})
		.join("");
}

/* ------------------------------------------------------------------ *
 * 列表点击
 * ------------------------------------------------------------------ */

function onListClick(event) {
	const playButton = event.target.closest("[data-playlist-play]");
	if (playButton) {
		event.stopPropagation();
		playPlaylist(playButton.dataset.playlistPlay, playButton.dataset.name);
		return;
	}
	const card = event.target.closest("[data-playlist]");
	if (card) {
		openPlaylist(card.dataset.playlist, card.dataset.name);
		return;
	}
	const songItem = event.target.closest("[data-song]");
	if (songItem) {
		const index = Number(songItem.dataset.song);
		if (Number.isFinite(index)) {
			playSongs(index);
		}
		return;
	}
	const favRemove = event.target.closest("[data-fav-remove]");
	if (favRemove) {
		event.stopPropagation();
		const id = favRemove.dataset.favRemove;
		session.favorites = session.favorites.filter(item => String(item.id) !== String(id));
		renderFavorites();
		return;
	}
	const favOpen = event.target.closest("[data-fav-open]");
	if (favOpen) {
		openPlaylist(favOpen.dataset.favOpen, favOpen.dataset.name);
	}
}

function onToolbarClick(event) {
	const button = event.target.closest("[data-tool]");
	if (!button) {
		return;
	}
	const tool = button.dataset.tool;
	if (tool === "refresh") {
		setView(state.view);
	} else if (tool === "search") {
		const input = dom.toolbar.querySelector('[data-role="search"]');
		state.searchKeyword = input ? input.value.trim() : "";
		doSearch(0);
	} else if (tool === "type") {
		state.searchType = Number(button.dataset.type);
		renderToolbar();
		renderList();
		if (state.lastQuery) {
			doSearch(0);
		}
	} else if (tool === "open-id") {
		const input = dom.toolbar.querySelector('[data-role="playlist-id"]');
		openPlaylistById(input ? input.value : "");
	} else if (tool === "back") {
		setView(state.currentPlaylist ? "mine" : "recommend");
	} else if (tool === "play-all") {
		if (state.songs.length) {
			playSongs(0);
		}
	} else if (tool === "shuffle-all") {
		if (state.songs.length) {
			player.setMode("shuffle");
			writeConfig("mode", "shuffle");
			playSongs(Math.floor(Math.random() * state.songs.length));
			toast("已开始随机播放");
		}
	} else if (tool === "fav-add") {
		addFavorite();
	}
}

/** 播放当前列表（会把歌单信息一并交给播放器，便于重载后恢复） */
function playSongs(startIndex) {
	if (!state.songs.length) {
		return;
	}
	player.setTracks(state.songs, startIndex, true, {
		title: state.songTitle,
		id: state.currentPlaylist ? state.currentPlaylist.id : player.playlistId,
	});
}

/** 直接播放整个歌单 */
async function playPlaylist(id, name) {
	await run(async () => {
		const detail = await api.fetchPlaylistDetail(id);
		state.songs = detail.tracks;
		state.songTitle = detail.info.name || name || "歌单";
		state.currentPlaylist = detail.info;
		state.view = "songs";
		writeConfig("lastPlaylist", String(id));
		writeConfig("lastPlaylistName", state.songTitle);
		renderSide();
		renderToolbar();
		renderList();
		if (state.songs.length) {
			playSongs(0);
		}
	}, "播放歌单");
}

/* ------------------------------------------------------------------ *
 * 常用歌单
 * ------------------------------------------------------------------ */

function addFavorite() {
	const info = state.currentPlaylist;
	if (!info) {
		toast("请先打开一个歌单");
		return;
	}
	const list = session.favorites.slice();
	if (list.some(item => String(item.id) === String(info.id))) {
		toast("这个歌单已经在常用列表里了");
		return;
	}
	list.unshift({ id: String(info.id), name: info.name, cover: info.cover, trackCount: info.trackCount });
	session.favorites = list.slice(0, 50);
	toast("已加入常用歌单");
}

function renderFavorites() {
	const list = session.favorites;
	state.playlists = list;
	if (!list.length) {
		dom.list.innerHTML = `<div class="nmb-empty">还没有常用歌单。<br>打开任意歌单后点击工具栏的「☆ 常用」即可收藏到这里。</div>`;
		return;
	}
	dom.list.innerHTML = list
		.map(
			item => `
		<div class="nmb-card" data-fav-open="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">
			<img src="${escapeAttr(item.cover || "")}" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.visibility='hidden'">
			<div class="nmb-cardinfo">
				<div class="nmb-cardname">${escapeHtml(item.name || "未命名歌单")}</div>
				<div class="nmb-cardmeta">${item.trackCount || 0} 首</div>
			</div>
			<div class="nmb-cardopt">
				<button class="nmb-btn" data-playlist-play="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">▶ 播放</button>
				<button class="nmb-btn" data-fav-remove="${escapeAttr(item.id)}">移除</button>
			</div>
		</div>`
		)
		.join("");
}

/* ------------------------------------------------------------------ *
 * 账号与登录
 * ------------------------------------------------------------------ */

function accountText() {
	if (session.cookie && session.nickname) {
		return `已登录：${session.nickname}`;
	}
	if (session.cookie) {
		return "已保存登录信息";
	}
	return "未登录";
}

function refreshAccount(silent) {
	if (!session.cookie) {
		dom.account.textContent = "未登录";
		dom.account.classList.remove("nmb-online");
		return Promise.resolve(null);
	}
	dom.account.textContent = session.nickname ? `已登录：${session.nickname}` : "正在读取账号…";
	return api
		.fetchProfile()
		.then(profile => {
			session.uid = profile.uid;
			session.nickname = profile.nickname;
			session.avatar = profile.avatar;
			dom.account.textContent = `已登录：${profile.nickname}`;
			dom.account.classList.add("nmb-online");
			if (!silent) {
				if (state.view === "login") {
					renderLogin();
				}
				toast(`登录成功，欢迎 ${profile.nickname}`);
			}
			return profile;
		})
		.catch(error => {
			dom.account.textContent = "登录已失效";
			dom.account.classList.remove("nmb-online");
			if (!silent) {
				toast(`读取账号失败：${error.message}`, 3000);
			}
			return null;
		});
}

async function ensureProfile() {
	if (session.uid) {
		return { uid: session.uid, nickname: session.nickname, avatar: session.avatar };
	}
	return refreshAccount(true) || { uid: "", nickname: "", avatar: "" };
}

/** 渲染登录界面 */
function renderLogin() {
	dom.list.innerHTML = `
	<div class="nmb-login">
		<div class="nmb-block">
			<h4>当前状态</h4>
			<div>${session.cookie ? (session.nickname ? `已登录：<b>${escapeHtml(session.nickname)}</b>（UID ${escapeHtml(session.uid)}）` : "已保存登录信息，正在读取账号…") : "未登录（仍可浏览推荐歌单、排行榜，以及播放免费歌曲）"}</div>
			<div class="nmb-row">
				<button class="nmb-btn nmb-primary" data-login="refresh">刷新账号信息</button>
				<button class="nmb-btn" data-login="logout">退出登录</button>
			</div>
		</div>

		<div class="nmb-block">
			<h4>方式一：调用系统浏览器登录</h4>
			<div>点击下面的按钮会用系统默认浏览器打开网易云登录页，登录完成后回到这里用「方式三」粘贴 Cookie 即可同步账号。</div>
			<div class="nmb-row">
				<button class="nmb-btn nmb-primary" data-login="browser">🌐 打开浏览器登录网易云</button>
			</div>
		</div>

		<div class="nmb-block">
			<h4>方式二：弹出登录窗口（自动同步，推荐）</h4>
			<div>在弹出的窗口里登录网易云，登录成功后音乐盒会自动读取登录状态，无需手动复制 Cookie。</div>
			<div class="nmb-row">
				<button class="nmb-btn nmb-primary" data-login="window">🪟 弹出登录窗口并自动同步</button>
			</div>
			<div class="nmb-hint">该窗口使用独立的浏览器会话，Cookies 保存在无名杀目录中，不会影响你的系统浏览器。</div>
		</div>

		<div class="nmb-block">
			<h4>方式三：扫码登录</h4>
			<div>用手机上的「网易云音乐」App 扫描下方二维码即可登录。</div>
			<div class="nmb-row">
				<button class="nmb-btn nmb-primary" data-login="qr">📱 生成登录二维码</button>
			</div>
			<div class="nmb-qr" id="nmb-qr-box" style="display:none">
				<canvas id="nmb-qr-canvas" width="168" height="168"></canvas>
				<div class="nmb-qrstatus" id="nmb-qr-status">等待生成…</div>
			</div>
		</div>

		<div class="nmb-block">
			<h4>方式四：手动粘贴 Cookie</h4>
			<textarea class="nmb-input" id="nmb-cookie-input" placeholder="粘贴完整的 Cookie，或只粘贴 MUSIC_U 的值">${escapeAttr(session.cookie)}</textarea>
			<div class="nmb-row">
				<button class="nmb-btn nmb-primary" data-login="save-cookie">保存并验证</button>
				<button class="nmb-btn" data-login="clear-cookie">清空输入框</button>
			</div>
			<div class="nmb-hint">
				获取方法：在浏览器登录 <code>music.163.com</code> 后按 <code>F12</code> → <code>Application/应用</code> → <code>Cookies</code> → <code>https://music.163.com</code>，
				找到 <code>MUSIC_U</code> 并复制它的值（形如 <code>MUSIC_U=00xxxx…</code>），粘贴到上面的输入框即可。
			</div>
		</div>
	</div>`;

	dom.list.querySelector(".nmb-login").addEventListener("click", async event => {
		const button = event.target.closest("[data-login]");
		if (!button) {
			return;
		}
		const action = button.dataset.login;
		if (action === "browser") {
			const ok = openExternal(LOGIN_URL);
			toast(ok ? "已调用系统浏览器，登录后请回到这里用「方式四」粘贴 Cookie" : "无法调用系统浏览器，请手动打开 music.163.com 登录", 4200);
		} else if (action === "window") {
			openLoginWindow();
		} else if (action === "qr") {
			startQrLogin();
		} else if (action === "refresh") {
			await refreshAccount(false);
			renderLogin();
		} else if (action === "logout") {
			session.clear();
			api.setCookie("");
			dom.account.textContent = "未登录";
			dom.account.classList.remove("nmb-online");
			toast("已退出登录");
			renderLogin();
		} else if (action === "save-cookie") {
			await saveCookieFromInput();
		} else if (action === "clear-cookie") {
			const input = dom.list.querySelector("#nmb-cookie-input");
			if (input) {
				input.value = "";
			}
		}
	});

	// 恢复进行中的二维码
	if (state.qrKey && state.qrTimer) {
		const box = dom.list.querySelector("#nmb-qr-box");
		const canvas = dom.list.querySelector("#nmb-qr-canvas");
		if (box && canvas) {
			box.style.display = "flex";
			try {
				drawQrCode(canvas, api.qrContent(state.qrKey));
			} catch (e) {}
			setQrStatus(state.qrStatus || "等待扫码…");
		}
	}
	// 记住二维码状态
	const qrStatusNode = dom.list.querySelector("#nmb-qr-status");
	if (qrStatusNode && state.qrStatus) {
		qrStatusNode.textContent = state.qrStatus;
	}
}

/** 保存手填 Cookie */
async function saveCookieFromInput() {
	const input = dom.list.querySelector("#nmb-cookie-input");
	const value = input ? input.value.trim() : "";
	if (!value) {
		toast("请先粘贴 Cookie");
		return;
	}
	const cookie = value.includes("=") ? value : `MUSIC_U=${value}`;
	if (!/MUSIC_U=/.test(cookie)) {
		toast("Cookie 里没有找到 MUSIC_U，请检查是否复制完整");
		return;
	}
	api.setCookie(cookie);
	session.cookie = cookie;
	const profile = await refreshAccount(false);
	if (profile) {
		renderLogin();
	}
}

/** 弹出独立登录窗口并在登录成功后自动同步 */
function openLoginWindow() {
	const req = getRequire();
	let remote = null;
	try {
		remote = req && req("@electron/remote");
	} catch (e) {
		remote = null;
	}
	if (!remote || !remote.BrowserWindow || !remote.session) {
		toast("当前环境不支持弹出登录窗口，请使用「方式一」或「方式三」", 3600);
		return;
	}
	let win;
	try {
		const partition = "persist:noname-netease-login";
		win = new remote.BrowserWindow({
			width: 980,
			height: 720,
			title: "登录网易云音乐（登录成功后窗口会自动关闭）",
			autoHideMenuBar: true,
			webPreferences: {
				partition,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		win.loadURL(LOGIN_URL);
	} catch (e) {
		toast(`打开登录窗口失败：${e.message}`, 3600);
		return;
	}
	toast("请在弹出的窗口中登录网易云，登录成功后会自动同步", 3600);

	const ses = remote.session.fromPartition("persist:noname-netease-login");
	const timer = setInterval(async () => {
		if (win.isDestroyed()) {
			clearInterval(timer);
			return;
		}
		try {
			const cookies = await ses.cookies.get({});
			const picked = cookies.filter(item => String(item.domain || "").includes("music.163.com"));
			if (!picked.some(item => item.name === "MUSIC_U")) {
				return;
			}
			const cookie = picked.map(item => `${item.name}=${item.value}`).join("; ");
			clearInterval(timer);
			api.setCookie(cookie);
			session.cookie = cookie;
			const profile = await refreshAccount(false);
			try {
				win.close();
			} catch (e) {}
			if (profile) {
				toast(`登录成功，欢迎 ${profile.nickname}`);
				if (state.view === "login") {
					renderLogin();
				}
			}
		} catch (e) {
			// 忽略轮询中的临时错误
		}
	}, 1500);
	try {
		win.on("closed", () => clearInterval(timer));
	} catch (e) {}
}

/* ------------------------------------------------------------------ *
 * 扫码登录
 * ------------------------------------------------------------------ */

function setQrStatus(text) {
	const node = dom.list.querySelector("#nmb-qr-status");
	state.qrStatus = text;
	if (node) {
		node.textContent = text;
	}
}

function stopQrPolling() {
	if (state.qrTimer) {
		clearInterval(state.qrTimer);
		state.qrTimer = null;
	}
}

function drawQrCode(canvas, text) {
	const { size, modules } = qrEncode(text, "M");
	const quiet = 4;
	const scale = Math.max(2, Math.floor(168 / (size + quiet * 2)));
	const dim = (size + quiet * 2) * scale;
	canvas.width = dim;
	canvas.height = dim;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, dim, dim);
	ctx.fillStyle = "#000000";
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (modules[y][x]) {
				ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
			}
		}
	}
}

export async function startQrLogin() {
	const box = dom.list.querySelector("#nmb-qr-box");
	const canvas = dom.list.querySelector("#nmb-qr-canvas");
	if (!box || !canvas) {
		return;
	}
	box.style.display = "flex";
	stopQrPolling();
	setQrStatus("正在获取二维码…");
	try {
		const key = await api.createQrKey();
		state.qrKey = key;
		drawQrCode(canvas, api.qrContent(key));
		setQrStatus("请用网易云音乐 App 扫描二维码");
		state.qrTimer = setInterval(pollQr, 2000);
	} catch (e) {
		setQrStatus(`获取二维码失败：${e.message}`);
	}
}

async function pollQr() {
	if (!state.qrKey) {
		return;
	}
	try {
		const result = await api.pollQrLogin(state.qrKey);
		if (result.code === 800) {
			stopQrPolling();
			setQrStatus("二维码已过期，请重新生成");
		} else if (result.code === 801) {
			setQrStatus("等待扫码…");
		} else if (result.code === 802) {
			setQrStatus("已扫码，请在手机上确认登录");
		} else if (result.code === 803) {
			stopQrPolling();
			setQrStatus("登录成功！");
			session.cookie = api.getCookie();
			await refreshAccount(false);
			if (state.view === "login") {
				renderLogin();
			}
		} else if (result.code !== 200) {
			setQrStatus(`扫码状态异常：${result.code}`);
		}
	} catch (e) {
		// 单次轮询失败可以忽略
	}
}

/* ------------------------------------------------------------------ *
 * 游戏内按钮
 * ------------------------------------------------------------------ */

/** 对局中在右上角加一个「音乐」按钮 */
export function attachGameButton() {
	try {
		if (!ui || !ui.create || typeof ui.create.system !== "function") {
			return;
		}
		if (document.getElementById("nmb-system-button")) {
			return;
		}
		const node = ui.create.system("音乐", () => toggle(), true);
		node.id = "nmb-system-button";
		node.title = "网易云音乐盒";
	} catch (e) {
		console.warn(`[${EXT_NAME}] 添加游戏内按钮失败`, e);
	}
}

/** 扩展页面被点击「音乐盒」时使用 */
export function openFromMenu() {
	open();
	if (!root || !root.classList.contains("nmb-open")) {
		toast("音乐盒界面初始化失败，请查看控制台日志");
	}
}

/**
 * 扩展页面里的选项（音量、音质、播放模式、暂停背景音乐）
 * @param {string} key
 * @param {any} value
 */
export function applySetting(key, value) {
	install();
	if (key === "volume") {
		const volume = player.setVolume(Number(value) / (Number(value) > 1 ? 100 : 1));
		writeConfig("volume", volume);
	} else if (key === "quality") {
		player.setQuality(value);
		writeConfig("quality", value);
	} else if (key === "mode") {
		player.setMode(value);
		writeConfig("mode", value);
	} else if (key === "pauseBgm") {
		player.setPauseGameBgm(value !== false && value !== "false");
		writeConfig("pauseBgm", value !== false && value !== "false");
	}
}

/** 登录态文字（扩展页面用） */
export function loginSummary() {
	if (!session.cookie) {
		return "未登录：只能浏览推荐歌单、排行榜和免费歌曲";
	}
	if (session.nickname) {
		return `已登录：${session.nickname}（UID ${session.uid}）`;
	}
	return "已保存登录信息，打开音乐盒即可查看账号";
}

/** 当前播放的歌曲文字 */
export function playingSummary() {
	const track = player && player.current;
	return track ? `${track.name} - ${track.artists}` : "当前没有在播放歌曲";
}

export const musicBox = {
	install,
	open,
	close,
	toggle,
	toast,
	attachGameButton,
	openFromMenu,
	startQrLogin,
	applySetting,
	loginSummary,
	playingSummary,
	autoAttach,
	closeOutput,
	/** 按歌单 ID 或链接打开歌单（扩展页面 / 开局自动显示使用） */
	openPlaylistById,
};
