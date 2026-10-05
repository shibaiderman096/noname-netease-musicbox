/**
 * 网易云音乐盒 - 播放器内核
 *
 * 音频有三种输出方式：
 *   1. sink  —— 桌面端：Electron 隐藏窗口（player.html），游戏「重新开始」重载页面时音乐不中断
 *   2. iab   —— 安卓端：Cordova InAppBrowser 独立 WebView（同一个 player.html），
 *               通过同源 localStorage 收发命令/状态，同样能在页面重载时不断歌
 *   3. local —— 当前页面的 Audio 元素，兜底（重载会中断，但会记录进度并续播）
 *
 * 歌单、下一首、播放地址解析等逻辑始终在游戏页面里；页面重载后从 localStorage
 * 恢复状态并重新接管音频窗口，因此听感上是连续的。
 */
import { Emitter, clamp, getRequire, isDesktop, EXT_NAME } from "./util.js";
import * as api from "./api.js";
import { STATE_KEY, CMD_KEY, BEAT_KEY, BEAT_TIMEOUT_MS, sinkUrl, readSinkState, isSinkAlive, sendCommand, beat, clearChannel, clearState, clearCommand, resetCommand } from "./sink-channel.js";

export const PLAY_MODES = ["order", "loop", "single", "shuffle"];
export const MODE_LABELS = {
	order: "顺序播放",
	loop: "列表循环",
	single: "单曲循环",
	shuffle: "随机播放",
};

const SINK_TITLE = "NMB-AUDIO-SINK";
const SINK_PAGE = `extension/${EXT_NAME}/player.html`;
const STORAGE_KEY = "nmb_playback_state_v1";
const POLL_INTERVAL = 600;
/** 播放位置写盘的节流间隔 */
const SAVE_INTERVAL = 4000;

/** 读取上一次的播放记录（扩展启动时判断要不要续播） */
export function readPlaybackRecord() {
	try {
		const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
			return null;
		}
		return data;
	} catch (e) {
		return null;
	}
}

/** 清除播放记录 */
export function clearPlaybackRecord() {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (e) {}
}

/** 是否已经有正在运行的音频输出窗口（页面重载后据此决定要不要接管界面） */
export function hasRunningOutput() {
	// 安卓：InAppBrowser 音频窗口通过 localStorage 上报状态
	if (isSinkAlive()) {
		return true;
	}
	if (!isDesktop()) {
		return false;
	}
	const req = getRequire();
	if (!req) {
		return false;
	}
	try {
		const remote = req("@electron/remote");
		if (!remote || !remote.BrowserWindow) {
			return false;
		}
		for (const win of remote.BrowserWindow.getAllWindows()) {
			try {
				if (!win.isDestroyed() && win.getTitle() === SINK_TITLE) {
					return true;
				}
			} catch (e) {}
		}
	} catch (e) {}
	return false;
}

/** 安卓端可用的 InAppBrowser（用来开独立音频窗口） */
function getInAppBrowser() {
	const win = typeof window !== "undefined" ? window : null;
	const cordova = win && win.cordova;
	if (!cordova) {
		return null;
	}
	const iab = cordova.InAppBrowser || (cordova.plugins && cordova.plugins.inAppBrowser);
	return iab && typeof iab.open === "function" ? iab : null;
}

/** 安卓端是否具备「独立音频窗口」能力（桌面端走 Electron 那套） */
export function hasWindowSink() {
	if (isDesktop()) {
		return true;
	}
	return !!getInAppBrowser();
}

export class Player extends Emitter {
	constructor(options = {}) {
		super();
		this.quality = options.quality || "exhigh";
		this.mode = options.mode || "order";
		this.volume = clamp(Number(options.volume ?? 0.8), 0, 1);
		/** 获取无名杀背景音乐元素的方法（由界面层注入） */
		this.bgmProvider = options.bgmProvider || null;
		this.pauseGameBgm = options.pauseGameBgm !== false;

		this.tracks = [];
		this.index = -1;
		this.playlistTitle = "";
		this.playlistId = "";
		this.urlCache = new Map();
		this.requestToken = 0;
		this.bgmPaused = false;

		/** "sink"（桌面窗口）| "iab"（安卓 InAppBrowser 窗口）| "local" | null（尚未决定） */
		this.output = null;
		this.sink = null;
		/** 安卓 InAppBrowser 音频窗口的引用（页面重载后会丢失，靠 localStorage 通道继续控制） */
		this.iab = null;
		this.sinkFailed = false;
		this.audio = new Audio();
		this.audio.preload = "none";
		this.audio.volume = this.volume;

		this.state = {
			hasSrc: false,
			paused: true,
			ended: false,
			currentTime: 0,
			duration: 0,
			volume: this.volume,
			error: 0,
		};
		this._pollTimer = null;
		this._lastSave = 0;
		this._savedPosition = 0;
		this._savedAt = 0;

		this._bindLocalAudio();
		this._restoreState();
		this._attachExistingOutput();
	}

	/* ------------------------------------------------------------------ *
	 * 输出后端
	 * ------------------------------------------------------------------ */

	_getRemote() {
		const req = getRequire();
		if (!req) {
			return null;
		}
		try {
			const remote = req("@electron/remote");
			return remote && remote.BrowserWindow ? remote : null;
		} catch (e) {
			return null;
		}
	}

	/** 找到已存在的输出窗口（页面重载后靠它接续播放） */
	_findSink(remote) {
		if (!remote) {
			remote = this._getRemote();
		}
		if (!remote) {
			return null;
		}
		try {
			for (const win of remote.BrowserWindow.getAllWindows()) {
				try {
					if (!win.isDestroyed() && win.getTitle() === SINK_TITLE) {
						return win;
					}
				} catch (e) {}
			}
		} catch (e) {}
		return null;
	}

	_attachExistingSink() {
		const sink = this._findSink();
		if (!sink) {
			return false;
		}
		this.sink = sink;
		this.output = "sink";
		this._startPolling();
		return true;
	}

	/** 输出窗口是否已在运行（扩展启动时用于判断要不要恢复界面） */
	hasRunningOutput() {
		if (this.sink && !this.sink.isDestroyed()) {
			return true;
		}
		return hasRunningOutput();
	}

	/** 创建输出窗口并等待页面就绪 */
	async _createSink() {
		const remote = this._getRemote();
		if (!remote) {
			return null;
		}
		const existing = this._findSink(remote);
		if (existing) {
			return existing;
		}
		let win = null;
		try {
			let parent = null;
			try {
				parent = remote.getCurrentWindow();
			} catch (e) {
				parent = null;
			}
			win = new remote.BrowserWindow({
				show: false,
				width: 420,
				height: 140,
				skipTaskbar: true,
				autoHideMenuBar: true,
				title: SINK_TITLE,
				// 挂在游戏窗口下：关闭游戏窗口时一起结束，而「重新开始」只是页面重载，不会影响它
				parent: parent || undefined,
				webPreferences: {
					nodeIntegration: true,
					contextIsolation: false,
					backgroundThrottling: false,
					webSecurity: false,
					// 让本窗口也能使用 @electron/remote，从而自己判断「游戏窗口是否还在」并及时退出
					// @ts-ignore
					enableRemoteModule: true,
				},
			});
			const base = typeof location !== "undefined" ? location.href : "http://localhost:8089/index.html";
			win.loadURL(new URL(SINK_PAGE, base).toString());
		} catch (e) {
			console.warn(`[${EXT_NAME}] 创建音频输出窗口失败`, e);
			return null;
		}
		for (let i = 0; i < 50; i++) {
			await new Promise(resolve => setTimeout(resolve, 100));
			try {
				if (win.isDestroyed()) {
					return null;
				}
				const pong = await win.webContents.executeJavaScript("typeof NMBSink === 'undefined' ? '' : NMBSink.ping()", true);
				if (pong === "pong") {
					return win;
				}
			} catch (e) {}
		}
		return null;
	}

	/* ------------------------------------------------------------------ *
	 * 安卓：InAppBrowser 音频窗口（通过 localStorage 通道收发）
	 * ------------------------------------------------------------------ */

	/** 打开 InAppBrowser 音频窗口，并等它上报第一次状态 */
	async _createIabSink() {
		const iab = getInAppBrowser();
		if (!iab) {
			return false;
		}
		if (this.iab) {
			return true;
		}
		try {
			beat();
			// 清掉可能残留的旧命令（例如上一次的 close），避免新窗口一起来就自己关掉
			resetCommand();
			this.iab = iab.open(
				sinkUrl(),
				"_blank",
				"location=no,hidden=yes,clearcache=no,clearsessioncache=no,zoom=no,mediaPlaybackRequiresUserGesture=no"
			);
		} catch (e) {
			console.warn(`[${EXT_NAME}] 打开安卓音频窗口失败`, e);
			this.iab = null;
			return false;
		}
		// 等音频窗口上报第一次状态（说明页面加载成功、通道可用）
		for (let i = 0; i < 40; i++) {
			await new Promise(resolve => setTimeout(resolve, 150));
			beat();
			if (isSinkAlive()) {
				return true;
			}
		}
		// 起不来就把它关掉，别留一个空白窗口
		try {
			if (this.iab && typeof this.iab.close === "function") {
				this.iab.close();
			}
		} catch (e) {}
		this.iab = null;
		clearChannel();
		return false;
	}

	/**
	 * 音频窗口虽然开着但音频不动（部分客户端里隐藏 WebView 会被暂停）时，
	 * 退回页面内播放，避免"看起来在播其实没声音"。
	 */
	async _iabFallback(reason) {
		if (this.output !== "iab") {
			return;
		}
		const resumeAt = this.currentTime / 1000;
		this._stopPolling();
		try {
			sendCommand("close");
			clearState();
			const timer = setTimeout(() => clearCommand(), 5000);
			if (timer && typeof timer.unref === "function") {
				timer.unref();
			}
		} catch (e) {}
		this.iab = null;
		this.output = null;
		this.sinkFailed = true;
		this.emit("error", new Error(reason || "音频窗口无法后台播放，已改用页面内播放（重开会中断）"));
		const index = this.index;
		if (index >= 0 && this.tracks.length) {
			await this.playIndex(index, { startAt: resumeAt > 3 ? resumeAt : 0 }).catch(() => {});
		}
	}

	/** 安卓音频窗口是否卡住（播放中但进度一直不走） */
	_checkIabStall(state) {
		if (this.output !== "iab") {
			return;
		}
		if (state.paused || !state.hasSrc || state.ended) {
			this._iabLastTime = undefined;
			this._iabStallSince = 0;
			return;
		}
		// 还没真正开始播（还在缓冲/加载）时不判定卡住
		const ready = (Number(state.readyState) || 0) >= 2 || (Number(state.duration) || 0) > 0;
		if (!ready) {
			this._iabLastTime = undefined;
			this._iabStallSince = 0;
			return;
		}
		const time = Number(state.currentTime) || 0;
		if (this._iabLastTime === undefined || time > this._iabLastTime + 0.05) {
			this._iabLastTime = time;
			this._iabStallSince = 0;
			return;
		}
		if (!this._iabStallSince) {
			this._iabStallSince = Date.now();
			return;
		}
		if (Date.now() - this._iabStallSince > 8000) {
			this._iabStallSince = 0;
			this._iabFallback("音频窗口无法后台播放（进度没有前进），已改用页面内播放");
		}
	}

	/** 接管已经在运行的音频窗口（页面重载后走这条） */
	_attachExistingOutput() {
		// 桌面端：Electron 窗口
		if (this._attachExistingSink()) {
			return true;
		}
		// 安卓端：InAppBrowser 窗口（状态够新就认为它还在播）
		if (isSinkAlive()) {
			this.output = "iab";
			this.state = readSinkState() || this.state;
			this._startPolling();
			return true;
		}
		return false;
	}

	/** 当前输出是不是"独立窗口"（桌面 sink 或安卓 iab） */
	_isWindowOutput() {
		return this.output === "sink" || this.output === "iab";
	}

	/* ------------------------------------------------------------------ *
	 * 输出操作（统一入口，桌面/安卓/本地各走各的）
	 * ------------------------------------------------------------------ */

	async _outLoad(url, autoplay, meta) {
		if (this.output === "iab") {
			this._iabLastTime = undefined;
			this._iabStallSince = 0;
			sendCommand("load", { url, autoplay: autoplay !== false, volume: this.volume, seconds: 0, meta: meta || this._currentMeta() });
			return { ok: true };
		}
		if (this.output === "sink") {
			return await this._sinkEval(`NMBSink.load(${JSON.stringify(url)}, ${autoplay !== false}, ${JSON.stringify(meta || this._currentMeta())})`);
		}
		this.audio.src = url;
		if (autoplay === false) {
			return { ok: true };
		}
		try {
			await this.audio.play();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: String((e && e.message) || e) };
		}
	}

	async _outPlay() {
		if (this.output === "iab") {
			sendCommand("play");
			return;
		}
		if (this.output === "sink") {
			await this._sinkEval("NMBSink.play()").catch(() => {});
			return;
		}
		try {
			await this.audio.play();
		} catch (e) {
			this.emit("error", e);
		}
	}

	async _outPause() {
		if (this.output === "iab") {
			sendCommand("pause");
			return;
		}
		if (this.output === "sink") {
			await this._sinkEval("NMBSink.pause()").catch(() => {});
			return;
		}
		this.audio.pause();
	}

	async _outStop() {
		if (this.output === "iab") {
			sendCommand("stop");
			return;
		}
		if (this.output === "sink") {
			await this._sinkEval("NMBSink.stop()").catch(() => {});
		}
	}

	async _outSeek(seconds) {
		if (this.output === "iab") {
			sendCommand("seek", { seconds });
			return;
		}
		if (this.output === "sink") {
			await this._sinkEval(`NMBSink.seek(${seconds})`).catch(() => {});
			return;
		}
		try {
			this.audio.currentTime = seconds;
		} catch (e) {}
	}

	_outVolume(volume) {
		if (this.output === "iab") {
			sendCommand("volume", { volume });
			return;
		}
		if (this.output === "sink") {
			this._sinkEval(`NMBSink.volume(${volume})`).catch(() => {});
		}
	}

	/** 音频窗口上报的状态（iab 用 localStorage，sink 用 executeJavaScript） */
	async _outState() {
		if (this.output === "iab") {
			return readSinkState();
		}
		if (this.output === "sink") {
			return await this._sinkEval("NMBSink.state()");
		}
		return null;
	}

	/** 当前曲目信息（随 load 命令带到音频窗口，页面重载后据此恢复界面） */
	_currentMeta() {
		const track = this.current;
		return {
			id: track ? track.id : "",
			name: track ? track.name : "",
			artist: track ? track.artist : "",
			cover: track ? track.cover : "",
			index: this.index,
			mode: this.mode,
			title: this.playlistTitle,
			playlistId: this.playlistId,
		};
	}

	/** 决定使用哪种输出方式（首次播放时调用） */
	async _ensureOutput() {
		if (this._isWindowOutput() && this._outputAlive()) {
			return this.output;
		}
		if (this._isWindowOutput()) {
			this._sinkLost();
		}
		if (this.sinkFailed) {
			this.output = "local";
			return "local";
		}
		// 桌面端：Electron 隐藏窗口
		const sink = await this._createSink();
		if (sink) {
			this.sink = sink;
			this.output = "sink";
			this._startPolling();
			await this._sinkEval(`NMBSink.volume(${this.volume})`).catch(() => {});
			return "sink";
		}
		// 安卓端：InAppBrowser 独立 WebView（同源 localStorage 通道）
		if (await this._createIabSink()) {
			this.output = "iab";
			this._startPolling();
			sendCommand("volume", { volume: this.volume });
			return "iab";
		}
		this.sinkFailed = true;
		this.output = "local";
		return "local";
	}

	/** 当前窗口输出是否还活着 */
	_outputAlive() {
		if (this.output === "sink") {
			return !!(this.sink && !this.sink.isDestroyed());
		}
		if (this.output === "iab") {
			return isSinkAlive();
		}
		return false;
	}

	_sinkLost() {
		this.sink = null;
		this.output = null;
		this._stopPolling();
		this.state.hasSrc = false;
		this.state.paused = true;
	}

	async _sinkEval(code) {
		if (!this.sink || this.sink.isDestroyed()) {
			this._sinkLost();
			throw new Error("音频输出窗口已关闭");
		}
		try {
			return await this.sink.webContents.executeJavaScript(code, true);
		} catch (e) {
			this._sinkLost();
			throw e;
		}
	}

	/* ------------------------------------------------------------------ *
	 * 状态轮询（sink 模式）与本地事件（local 模式）
	 * ------------------------------------------------------------------ */

	_startPolling() {
		if (this._pollTimer) {
			return;
		}
		this._pollTimer = setInterval(() => {
			this._poll().catch(() => {});
		}, POLL_INTERVAL);
	}

	_stopPolling() {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	}

	/** 立即同步一次状态（界面初始化时用） */
	async refresh() {
		if (this._isWindowOutput()) {
			await this._poll().catch(() => {});
		}
		return this.state;
	}

	async _poll() {
		if (!this._isWindowOutput()) {
			return;
		}
		if (this.output === "iab") {
			beat();
		}
		const state = await this._outState();
		if (!state || typeof state !== "object") {
			if (this.output === "iab" && !isSinkAlive()) {
				// 音频窗口没了（被系统回收/自己退出），退回本地播放
				this._sinkLost();
				this.output = "local";
			}
			return;
		}
		this._applyState(state);
	}

	/** 处理一次状态更新（sink 与 iab 共用） */
	_applyState(state) {
		const previous = this.state;
		this.state = state;
		// 音频窗口上报的曲目信息：页面重载后据此恢复当前歌曲
		if (this.output === "iab" && state.meta && (!this.current || this.current.id !== state.meta.id)) {
			const meta = state.meta;
			const index = Number.isInteger(meta.index) && meta.index >= 0 && meta.index < this.tracks.length ? meta.index : this.index;
			if (this.tracks.length) {
				this.index = index;
				this.emit("track", this.current);
			}
		}

		if (state.error && state.error !== previous.error) {
			this._resumeGameBgm();
			this.emit("error", new Error("音频加载失败（可能是版权限制或需要登录）"));
			this.next(true);
			return;
		}
		if (state.ended && !previous.ended) {
			this._resumeGameBgm();
			this.next(true);
			return;
		}
		if (state.paused !== previous.paused) {
			if (state.paused) {
				this.emit("pause");
				this._resumeGameBgm();
			} else {
				this.emit("play");
				this._pauseGameBgm();
			}
		}
		if (state.volume !== previous.volume) {
			this.emit("volume", state.volume);
		}
		this.emit("time", (state.currentTime || 0) * 1000);
		this._saveState();
		if (state.duration !== previous.duration) {
			this.emit("duration", (state.duration || 0) * 1000);
		}
		if (!state.paused) {
			this._keepGameBgmPaused();
		}
		this._checkIabStall(state);
	}

	_bindLocalAudio() {
		const audio = this.audio;
		audio.addEventListener("play", () => {
			this.state.paused = false;
			this.emit("play");
			this._pauseGameBgm();
		});
		audio.addEventListener("pause", () => {
			this.state.paused = true;
			this.emit("pause");
			this._resumeGameBgm();
		});
		audio.addEventListener("ended", () => {
			this._resumeGameBgm();
			this.next(true);
		});
		audio.addEventListener("timeupdate", () => {
			this.emit("time", audio.currentTime * 1000);
			this._saveState();
		});
		audio.addEventListener("loadedmetadata", () => {
			this.state.duration = audio.duration || 0;
			this.emit("duration", (audio.duration || 0) * 1000);
		});
		audio.addEventListener("error", () => {
			if (!audio.src) {
				return;
			}
			this._resumeGameBgm();
			this.emit("error", new Error("音频加载失败（可能是版权限制或需要登录）"));
			this.next(true);
		});
	}

	/* ------------------------------------------------------------------ *
	 * 游戏背景音乐
	 * ------------------------------------------------------------------ */

	_getBgm() {
		try {
			return this.bgmProvider ? this.bgmProvider() : null;
		} catch (e) {
			return null;
		}
	}

	_pauseGameBgm() {
		if (!this.pauseGameBgm || this.bgmPaused) {
			return;
		}
		const bgm = this._getBgm();
		if (bgm && !bgm.paused) {
			bgm.pause();
			this.bgmPaused = true;
		}
	}

	/** 游戏重载后背景音乐可能重新开始播放，这里持续压制 */
	_keepGameBgmPaused() {
		if (!this.pauseGameBgm) {
			return;
		}
		const bgm = this._getBgm();
		if (bgm && !bgm.paused) {
			bgm.pause();
			this.bgmPaused = true;
		}
	}

	_resumeGameBgm() {
		if (!this.bgmPaused) {
			return;
		}
		this.bgmPaused = false;
		const bgm = this._getBgm();
		if (bgm) {
			const promise = bgm.play();
			if (promise && promise.catch) {
				promise.catch(() => {});
			}
		}
	}

	/* ------------------------------------------------------------------ *
	 * 状态持久化（跨页面重载恢复）
	 * ------------------------------------------------------------------ */

	_saveState(force = false) {
		const now = Date.now();
		if (!force && now - (this._lastSave || 0) < SAVE_INTERVAL) {
			return;
		}
		this._lastSave = now;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					tracks: this.tracks.slice(0, 500),
					index: this.index,
					mode: this.mode,
					title: this.playlistTitle,
					id: this.playlistId,
					/** 播放位置（秒），用于下次打开游戏接着播 */
					position: Math.max(0, Math.floor((this.currentTime || 0) / 1000)),
					savedAt: now,
				})
			);
		} catch (e) {}
	}

	_restoreState() {
		try {
			const data = readPlaybackRecord();
			if (!data) {
				return;
			}
			this.tracks = data.tracks;
			this.index = Number.isInteger(data.index) && data.index >= 0 && data.index < data.tracks.length ? data.index : 0;
			this.mode = PLAY_MODES.includes(data.mode) ? data.mode : this.mode;
			this.playlistTitle = data.title || "";
			this.playlistId = data.id || "";
			this._savedPosition = Number(data.position) || 0;
			this._savedAt = Number(data.savedAt) || 0;
		} catch (e) {}
	}

	/**
	 * 接着上次的记录播放（打开游戏时用）
	 * @returns {Promise<boolean>} 是否真的开始播放
	 */
	async resumeLast() {
		if (!this.tracks.length || this.playing || this.hasSource) {
			return false;
		}
		const index = this.index >= 0 && this.index < this.tracks.length ? this.index : 0;
		const track = this.tracks[index];
		let startAt = Number(this._savedPosition) || 0;
		// 太靠近结尾就从头播；记录太旧（超过 12 小时）也从头播
		if (track && track.duration) {
			if (startAt > track.duration / 1000 - 15) {
				startAt = 0;
			}
		}
		if (this._savedAt && Date.now() - this._savedAt > 12 * 3600 * 1000) {
			startAt = 0;
		}
		this._savedPosition = 0;
		await this.playIndex(index, { startAt });
		return true;
	}

	/* ------------------------------------------------------------------ *
	 * 对外状态
	 * ------------------------------------------------------------------ */

	get current() {
		return this.tracks[this.index] || null;
	}

	get hasSource() {
		return this._isWindowOutput() ? !!this.state.hasSrc : !!this.audio.src;
	}

	get playing() {
		if (this._isWindowOutput()) {
			return !!this.state.hasSrc && !this.state.paused && !this.state.ended;
		}
		return !!this.audio.src && !this.audio.paused && !this.audio.ended;
	}

	get duration() {
		if (this._isWindowOutput()) {
			return (this.state.duration || 0) * 1000;
		}
		return (this.audio.duration || 0) * 1000;
	}

	get currentTime() {
		if (this._isWindowOutput()) {
			return (this.state.currentTime || 0) * 1000;
		}
		return this.audio.currentTime * 1000;
	}

	get outputName() {
		return this.output || "unknown";
	}

	/* ------------------------------------------------------------------ *
	 * 播放列表
	 * ------------------------------------------------------------------ */

	setTracks(tracks, startIndex = 0, autoplay = true, meta = {}) {
		this.tracks = Array.isArray(tracks) ? tracks.slice() : [];
		this.index = -1;
		if (meta.title !== undefined) {
			this.playlistTitle = meta.title || "";
		}
		if (meta.id !== undefined) {
			this.playlistId = String(meta.id || "");
		}
		this.emit("list", this.tracks);
		if (!this.tracks.length) {
			this.stop();
			this._saveState(true);
			return;
		}
		this._saveState(true);
		if (autoplay) {
			this.playIndex(clamp(startIndex, 0, this.tracks.length - 1));
		}
	}

	async playIndex(index, options = {}) {
		if (!this.tracks.length || index < 0 || index >= this.tracks.length) {
			return;
		}
		const track = this.tracks[index];
		const token = ++this.requestToken;
		this.index = index;
		this.emit("track", track);
		this.emit("loading", true);
		this._saveState(true);
		try {
			const info = await this._resolveUrl(track.id);
			if (token !== this.requestToken) {
				return;
			}
			this.emit("trial", info.trial, info.level);
			await this._ensureOutput();
			if (token !== this.requestToken) {
				return;
			}
			const result = await this._loadUrl(info.url);
			if (result && result.ok === false) {
				this.emit("error", new Error(result.error || "播放失败"));
			} else if (options.startAt > 1) {
				await this.seekSeconds(options.startAt);
			}
		} catch (e) {
			if (token === this.requestToken) {
				this.emit("error", e);
			}
		} finally {
			if (token === this.requestToken) {
				this.emit("loading", false);
			}
		}
	}

	/** 按秒跳转（续播用；与 seek(ratio) 区分） */
	async seekSeconds(seconds) {
		const target = Number(seconds) || 0;
		if (target <= 1) {
			return;
		}
		this.state.currentTime = target;
		if (this._isWindowOutput()) {
			await this._outSeek(target);
			return;
		}
		try {
			if (this.audio.readyState >= 1) {
				this.audio.currentTime = target;
			} else {
				await new Promise(resolve => {
					const done = () => {
						try {
							this.audio.currentTime = target;
						} catch (e) {}
						resolve();
					};
					this.audio.addEventListener("loadedmetadata", done, { once: true });
					setTimeout(done, 1500);
				});
			}
		} catch (e) {}
	}

	async _resolveUrl(id) {
		const cached = this.urlCache.get(id);
		if (cached && cached.expire > Date.now()) {
			return cached.info;
		}
		const info = await api.fetchSongUrl(id, this.quality);
		this.urlCache.set(id, { info, expire: Date.now() + 30 * 60 * 1000 });
		return info;
	}

	async _loadUrl(url) {
		if (this._isWindowOutput()) {
			return await this._outLoad(url, true, this._currentMeta());
		}
		this.audio.src = url;
		try {
			await this.audio.play();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: String((e && e.message) || e) };
		}
	}

	async toggle() {
		if (!this.hasSource) {
			if (this.tracks.length) {
				await this.playIndex(this.index >= 0 ? this.index : 0);
			}
			return;
		}
		if (this.playing) {
			await this.pause();
		} else {
			await this.resume();
		}
	}

	async pause() {
		this.state.paused = true;
		this.emit("pause");
		this._resumeGameBgm();
		this._saveState(true);
		if (this._isWindowOutput()) {
			await this._outPause();
			return;
		}
		this.audio.pause();
	}

	async resume() {
		this.state.paused = false;
		this.emit("play");
		this._pauseGameBgm();
		if (this._isWindowOutput()) {
			await this._outPlay();
			return;
		}
		try {
			await this.audio.play();
		} catch (e) {
			this.emit("error", e);
		}
	}

	async stop() {
		this.requestToken++;
		this._resumeGameBgm();
		this.state.paused = true;
		this.state.hasSrc = false;
		this.state.currentTime = 0;
		this.state.ended = false;
		this.audio.pause();
		this.audio.removeAttribute("src");
		try {
			this.audio.load();
		} catch (e) {}
		if (this._isWindowOutput()) {
			await this._outStop();
		}
		this.index = -1;
		this.emit("track", null);
		this._saveState(true);
	}

	next(auto = false) {
		if (!this.tracks.length) {
			return;
		}
		if (this.mode === "single" && auto) {
			this.playIndex(this.index);
			return;
		}
		let nextIndex;
		if (this.mode === "shuffle") {
			nextIndex = this._randomIndex();
		} else if (this.index + 1 >= this.tracks.length) {
			if (this.mode === "order" && auto) {
				this.state.paused = true;
				this.emit("pause");
				this.emit("finished");
				this._resumeGameBgm();
				return;
			}
			nextIndex = 0;
		} else {
			nextIndex = this.index + 1;
		}
		this.playIndex(nextIndex);
	}

	prev() {
		if (!this.tracks.length) {
			return;
		}
		if (this.mode === "shuffle") {
			this.playIndex(this._randomIndex());
			return;
		}
		this.playIndex(this.index - 1 < 0 ? this.tracks.length - 1 : this.index - 1);
	}

	_randomIndex() {
		if (this.tracks.length <= 1) {
			return 0;
		}
		let index = this.index;
		while (index === this.index) {
			index = Math.floor(Math.random() * this.tracks.length);
		}
		return index;
	}

	async seek(ratio) {
		const duration = this.duration;
		if (!duration) {
			return;
		}
		const seconds = clamp(ratio, 0, 1) * (duration / 1000);
		this.state.currentTime = seconds;
		if (this._isWindowOutput()) {
			await this._outSeek(seconds);
			return;
		}
		try {
			this.audio.currentTime = seconds;
		} catch (e) {}
	}

	setVolume(value) {
		const volume = clamp(Number(value) || 0, 0, 1);
		this.volume = volume;
		this.state.volume = volume;
		this.audio.volume = volume;
		if (this._isWindowOutput()) {
			this._outVolume(volume);
		}
		this.emit("volume", volume);
		return volume;
	}

	setMode(mode) {
		if (!PLAY_MODES.includes(mode)) {
			return this.mode;
		}
		this.mode = mode;
		this._saveState(true);
		this.emit("mode", mode);
		return mode;
	}

	nextMode() {
		const index = PLAY_MODES.indexOf(this.mode);
		return this.setMode(PLAY_MODES[(index + 1) % PLAY_MODES.length]);
	}

	setQuality(quality) {
		this.quality = quality || "exhigh";
		this.urlCache.clear();
	}

	setPauseGameBgm(value) {
		this.pauseGameBgm = !!value;
		if (!this.pauseGameBgm) {
			this._resumeGameBgm();
		}
	}

	/** 立即把当前状态与播放位置写入本地记录（关闭/重载页面前调用） */
	saveNow() {
		this._saveState(true);
	}

	/** 关闭音频输出窗口（删除扩展时调用） */
	closeOutput() {
		this._stopPolling();
		try {
			if (this.sink && !this.sink.isDestroyed()) {
				this.sink.close();
			}
		} catch (e) {}
		// 安卓：通知 InAppBrowser 音频窗口自己关闭，然后清掉通道数据
		try {
			if (this.output === "iab" || isSinkAlive()) {
				sendCommand("close");
				// 命令要留给音频窗口读（它每 700ms 轮询一次），所以只先清状态，
				// 等它处理完再清命令，避免被新开的窗口读到旧的 close。
				clearState();
				const timer = setTimeout(() => clearCommand(), 5000);
				if (timer && typeof timer.unref === "function") {
					timer.unref();
				}
			} else {
				clearChannel();
			}
			if (this.iab && typeof this.iab.close === "function") {
				this.iab.close();
			}
		} catch (e) {}
		this.sink = null;
		this.iab = null;
		this.output = null;
	}

	destroy() {
		this.requestToken++;
		this._stopPolling();
		this._resumeGameBgm();
		try {
			this.audio.pause();
			this.audio.removeAttribute("src");
		} catch (e) {}
		this.tracks = [];
	}
}
