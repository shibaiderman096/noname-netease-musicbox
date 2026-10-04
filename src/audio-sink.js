/**
 * 音频输出窗口（隐藏窗口里运行）
 *
 * 意义：无名杀的「重新开始 / 重来」会执行 window.location.reload()，
 * 游戏页面里的一切（包括 Audio 元素）都会被销毁；把音频放在这个独立窗口里，
 * 页面重载期间音乐不会中断，重载后游戏页面再重新接管控制。
 *
 * 本文件只负责「播放一个给定的 URL」，歌单、下一首等逻辑仍然在游戏页面里。
 */
const audio = document.getElementById("audio");
let lastError = 0;

audio.addEventListener("error", () => {
	lastError = audio.error ? audio.error.code || -1 : -1;
});
audio.addEventListener("playing", () => {
	lastError = 0;
});
audio.addEventListener("canplay", () => {
	lastError = 0;
});

function asResult(promise) {
	if (!promise || typeof promise.then !== "function") {
		return Promise.resolve({ ok: true });
	}
	return promise.then(
		() => ({ ok: true, error: "" }),
		error => ({ ok: false, error: String((error && error.message) || error || "播放失败") })
	);
}

window.NMBSink = {
	ping() {
		return "pong";
	},
	/** 载入并播放 */
	load(url, autoplay = true) {
		lastError = 0;
		audio.src = url;
		try {
			audio.load();
		} catch (e) {}
		if (!autoplay) {
			return { ok: true, error: "" };
		}
		return asResult(audio.play());
	},
	play() {
		return asResult(audio.play());
	},
	pause() {
		audio.pause();
		return { ok: true };
	},
	stop() {
		audio.pause();
		audio.removeAttribute("src");
		try {
			audio.load();
		} catch (e) {}
		lastError = 0;
		return { ok: true };
	},
	seek(seconds) {
		try {
			if (isFinite(seconds)) {
				audio.currentTime = Math.max(0, Number(seconds) || 0);
			}
		} catch (e) {}
		return { ok: true };
	},
	volume(value) {
		const volume = Math.min(1, Math.max(0, Number(value) || 0));
		audio.volume = volume;
		return { ok: true, volume };
	},
	/** 供游戏页面轮询的状态 */
	state() {
		return {
			hasSrc: !!(audio.currentSrc || audio.getAttribute("src")),
			paused: !!audio.paused,
			ended: !!audio.ended,
			currentTime: audio.currentTime || 0,
			duration: isFinite(audio.duration) ? audio.duration : 0,
			volume: audio.volume,
			error: lastError,
			readyState: audio.readyState,
		};
	},
};

/* 兜底：万一没有随游戏窗口一起关闭，检测到没有其它窗口时自行退出。
   （本窗口通常是游戏窗口的子窗口，关闭游戏时会自动结束；这里只作保险。） */
(function watchdog() {
	let remote = null;
	try {
		remote = require("@electron/remote");
	} catch (e) {
		remote = null;
	}
	if (!remote || !remote.BrowserWindow) {
		return;
	}
	let self = null;
	try {
		self = remote.getCurrentWindow();
	} catch (e) {
		return;
	}
	setInterval(() => {
		try {
			const others = remote.BrowserWindow.getAllWindows().filter(win => win.id !== self.id);
			if (!others.length) {
				window.close();
			}
		} catch (e) {}
	}, 2000);
})();
