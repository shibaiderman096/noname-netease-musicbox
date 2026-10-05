/**
 * 网易云音乐盒 - 歌词解析（LRC）
 */

/**
 * 解析 LRC 文本
 * 支持 [mm:ss.xx] / [mm:ss:xx] / [mm:ss]，以及一行多个时间标签
 * @param {string} text
 * @returns {{ time: number, text: string }[]} 按时间升序（time 单位毫秒）
 */
export function parseLrc(text) {
	const lines = [];
	const timeTag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
	for (const raw of String(text || "").split(/\r?\n/)) {
		const tags = [...raw.matchAll(timeTag)];
		if (!tags.length) {
			continue;
		}
		const content = raw.replace(timeTag, "").trim();
		if (!content) {
			continue;
		}
		for (const tag of tags) {
			const minutes = Number(tag[1]) || 0;
			const seconds = Number(tag[2]) || 0;
			const fraction = tag[3] ? Number(`0.${tag[3]}`) : 0;
			lines.push({ time: Math.round((minutes * 60 + seconds + fraction) * 1000), text: content });
		}
	}
	lines.sort((a, b) => a.time - b.time);
	return lines;
}

/**
 * 找出当前时间对应的歌词行下标（-1 表示还没到第一句）
 * @param {{ time: number }[]} lines
 * @param {number} ms
 */
export function currentLyricIndex(lines, ms) {
	if (!lines || !lines.length) {
		return -1;
	}
	let index = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].time <= ms) {
			index = i;
		} else {
			break;
		}
	}
	return index;
}
