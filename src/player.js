/**
 * 网易云音乐盒 - 播放器内核
 *
 * 音频有两种输出方式：
 *   1. sink  —— 独立的隐藏窗口（player.html），游戏「重新开始」重载页面时音乐不中断（推荐）
 *   2. local —— 当前页面的 Audio 元素，在没有 Electron remote 能力时兜底
 *
 * 歌单、下一首、播放地址解析等逻辑始终在游戏页面里；页面重载后从 localStorage
 * 恢复状态并重新接管 sink 窗口，因此听感上是连续的。
 */
import { Emitter, clamp, getRequire, EXT_NAME } from "./util.js";
import * as api from "./api.js";

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

		/** "sink" | "local" | null（null 表示尚未决定，首次播放时再判断） */
		this.output = null;
		this.sink = null;
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
		this._attachExistingSink();
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

	/** 决定使用哪种输出方式（首次播放时调用） */
	async _ensureOutput() {
		if (this.output === "sink" && this.sink && !this.sink.isDestroyed()) {
			return "sink";
		}
		if (this.output === "sink") {
			this._sinkLost();
		}
		if (this.sinkFailed) {
			this.output = "local";
			return "local";
		}
		const sink = await this._createSink();
		if (sink) {
			this.sink = sink;
			this.output = "sink";
			this._startPolling();
			await this._sinkEval(`NMBSink.volume(${this.volume})`).catch(() => {});
			return "sink";
		}
		this.sinkFailed = true;
		this.output = "local";
		return "local";
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
		if (this.output === "sink") {
			await this._poll().catch(() => {});
		}
		return this.state;
	}

	async _poll() {
		if (this.output !== "sink" || !this.sink) {
			return;
		}
		const state = await this._sinkEval("NMBSink.state()");
		if (!state || typeof state !== "object") {
			return;
		}
		const previous = this.state;
		this.state = state;

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
		return this.output === "sink" ? !!this.state.hasSrc : !!this.audio.src;
	}

	get playing() {
		if (this.output === "sink") {
			return !!this.state.hasSrc && !this.state.paused && !this.state.ended;
		}
		return !!this.audio.src && !this.audio.paused && !this.audio.ended;
	}

	get duration() {
		if (this.output === "sink") {
			return (this.state.duration || 0) * 1000;
		}
		return (this.audio.duration || 0) * 1000;
	}

	get currentTime() {
		if (this.output === "sink") {
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
		if (this.output === "sink") {
			await this._sinkEval(`NMBSink.seek(${target})`).catch(() => {});
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
		if (this.output === "sink") {
			return await this._sinkEval(`NMBSink.load(${JSON.stringify(url)}, true)`);
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
		if (this.output === "sink") {
			await this._sinkEval("NMBSink.pause()").catch(() => {});
			return;
		}
		this.audio.pause();
	}

	async resume() {
		this.state.paused = false;
		this.emit("play");
		this._pauseGameBgm();
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
		if (this.output === "sink") {
			await this._sinkEval("NMBSink.stop()").catch(() => {});
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
		if (this.output === "sink") {
			await this._sinkEval(`NMBSink.seek(${seconds})`).catch(() => {});
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
		if (this.output === "sink") {
			this._sinkEval(`NMBSink.volume(${volume})`).catch(() => {});
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
		this.sink = null;
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
