/**
 * 网易云音乐盒 - 播放器内核
 *
 * 只依赖 api/util，不直接依赖无名杀，方便单独调试。
 * 通过事件把状态变化交给界面层：
 *   track / play / pause / loading / time / duration / volume / mode / error / trial / list
 */
import { Emitter, clamp } from "./util.js";
import * as api from "./api.js";

export const PLAY_MODES = ["order", "loop", "single", "shuffle"];
export const MODE_LABELS = {
	order: "顺序播放",
	loop: "列表循环",
	single: "单曲循环",
	shuffle: "随机播放",
};

export class Player extends Emitter {
	constructor(options = {}) {
		super();
		this.quality = options.quality || "exhigh";
		this.mode = options.mode || "order";
		this.tracks = [];
		this.index = -1;
		this.urlCache = new Map();
		this.requestToken = 0;
		this.bgmPaused = false;
		/** 获取无名杀背景音乐元素的方法（由界面层注入） */
		this.bgmProvider = options.bgmProvider || null;
		this.pauseGameBgm = options.pauseGameBgm !== false;

		this.audio = new Audio();
		this.audio.preload = "none";
		this.audio.volume = clamp(Number(options.volume ?? 0.8), 0, 1);
		this._bindAudio();
	}

	_bindAudio() {
		const audio = this.audio;
		audio.addEventListener("play", () => {
			this.emit("play");
			this._pauseGameBgm();
		});
		audio.addEventListener("pause", () => {
			this.emit("pause");
			this._resumeGameBgm();
		});
		audio.addEventListener("ended", () => {
			this._resumeGameBgm();
			this.next(true);
		});
		audio.addEventListener("timeupdate", () => {
			this.emit("time", audio.currentTime * 1000);
		});
		audio.addEventListener("loadedmetadata", () => {
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

	/* ---------------------------- 游戏背景音乐 ---------------------------- */

	_pauseGameBgm() {
		if (!this.pauseGameBgm || this.bgmPaused) {
			return;
		}
		try {
			const bgm = this.bgmProvider && this.bgmProvider();
			if (bgm && !bgm.paused) {
				bgm.pause();
				this.bgmPaused = true;
			}
		} catch (e) {}
	}

	_resumeGameBgm() {
		if (!this.bgmPaused) {
			return;
		}
		this.bgmPaused = false;
		try {
			const bgm = this.bgmProvider && this.bgmProvider();
			if (bgm) {
				const promise = bgm.play();
				if (promise && promise.catch) {
					promise.catch(() => {});
				}
			}
		} catch (e) {}
	}

	/* ------------------------------- 播放列表 ------------------------------- */

	get current() {
		return this.tracks[this.index] || null;
	}

	get playing() {
		return !!this.audio.src && !this.audio.paused && !this.audio.ended;
	}

	/**
	 * 设置播放列表
	 * @param {Array} tracks
	 * @param {number} startIndex
	 * @param {boolean} autoplay
	 */
	setTracks(tracks, startIndex = 0, autoplay = true) {
		this.tracks = Array.isArray(tracks) ? tracks.slice() : [];
		this.index = -1;
		this.emit("list", this.tracks);
		if (!this.tracks.length) {
			this.stop();
			return;
		}
		if (autoplay) {
			this.playIndex(clamp(startIndex, 0, this.tracks.length - 1));
		}
	}

	/** 播放指定序号 */
	async playIndex(index) {
		if (!this.tracks.length) {
			return;
		}
		if (index < 0 || index >= this.tracks.length) {
			return;
		}
		const track = this.tracks[index];
		const token = ++this.requestToken;
		this.index = index;
		this.emit("track", track);
		this.emit("loading", true);
		try {
			const info = await this._resolveUrl(track.id);
			if (token !== this.requestToken) {
				return;
			}
			this.emit("trial", info.trial, info.level);
			this.audio.src = info.url;
			await this.audio.play();
		} catch (e) {
			if (token !== this.requestToken) {
				return;
			}
			this.emit("error", e);
		} finally {
			if (token === this.requestToken) {
				this.emit("loading", false);
			}
		}
	}

	/** 解析播放地址（带 30 分钟缓存） */
	async _resolveUrl(id) {
		const cached = this.urlCache.get(id);
		if (cached && cached.expire > Date.now()) {
			return cached.info;
		}
		const info = await api.fetchSongUrl(id, this.quality);
		this.urlCache.set(id, { info, expire: Date.now() + 30 * 60 * 1000 });
		return info;
	}

	/** 播放 / 暂停 */
	toggle() {
		if (!this.audio.src) {
			if (this.tracks.length) {
				this.playIndex(this.index >= 0 ? this.index : 0);
			}
			return;
		}
		if (this.audio.paused) {
			const promise = this.audio.play();
			if (promise && promise.catch) {
				promise.catch(e => this.emit("error", e));
			}
		} else {
			this.audio.pause();
		}
	}

	pause() {
		this.audio.pause();
	}

	stop() {
		this.requestToken++;
		this.audio.pause();
		this.audio.removeAttribute("src");
		this.audio.load();
		this.index = -1;
		this.emit("track", null);
		this._resumeGameBgm();
	}

	/** 下一首 */
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
				// 顺序播放播完即停
				this.audio.pause();
				this.audio.currentTime = 0;
				this.emit("finished");
				return;
			}
			nextIndex = 0;
		} else {
			nextIndex = this.index + 1;
		}
		this.playIndex(nextIndex);
	}

	/** 上一首 */
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

	/** 拖动进度条（0~1） */
	seek(ratio) {
		if (!this.audio.duration) {
			return;
		}
		this.audio.currentTime = clamp(ratio, 0, 1) * this.audio.duration;
	}

	/** 设置音量 0~1 */
	setVolume(value) {
		const volume = clamp(Number(value) || 0, 0, 1);
		this.audio.volume = volume;
		this.emit("volume", volume);
		return volume;
	}

	/** 设置播放模式 */
	setMode(mode) {
		if (!PLAY_MODES.includes(mode)) {
			return this.mode;
		}
		this.mode = mode;
		this.emit("mode", mode);
		return mode;
	}

	nextMode() {
		const index = PLAY_MODES.indexOf(this.mode);
		return this.setMode(PLAY_MODES[(index + 1) % PLAY_MODES.length]);
	}

	/** 设置音质 */
	setQuality(quality) {
		this.quality = quality || "exhigh";
		this.urlCache.clear();
	}

	/** 切换暂停游戏背景音乐 */
	setPauseGameBgm(value) {
		this.pauseGameBgm = !!value;
		if (!this.pauseGameBgm) {
			this._resumeGameBgm();
		}
	}

	destroy() {
		this.requestToken++;
		try {
			this.audio.pause();
			this.audio.removeAttribute("src");
		} catch (e) {}
		this._resumeGameBgm();
		this.tracks = [];
	}
}
