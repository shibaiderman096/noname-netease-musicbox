/**
 * 网易云音乐盒 - 二维码生成（纯 JS，无第三方依赖）
 *
 * 按 ISO/IEC 18004 实现：字节模式、版本 1~10、纠错等级 L/M，
 * 足够容纳网易云扫码登录所需的 72 字符链接。
 */

/** 各版本总码字数（数据 + 纠错） */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** 每个纠错块的纠错码字数 */
const ECC_PER_BLOCK = {
	L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
	M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};

/** 纠错块数量 */
const ECC_BLOCKS = {
	L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
	M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};

/** 格式信息中的纠错等级编码 */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/** 各版本对齐图案中心坐标 */
const ALIGNMENT_POSITIONS = [
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46],
	[6, 28, 50],
];

/** 各版本末尾剩余位 */
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

/** UTF-8 编码 */
function toUtf8Bytes(text) {
	if (typeof TextEncoder !== "undefined") {
		return [...new TextEncoder().encode(text)];
	}
	const bytes = [];
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}
	return bytes;
}

function numDataCodewords(version, level) {
	return TOTAL_CODEWORDS[version - 1] - ECC_PER_BLOCK[level][version - 1] * ECC_BLOCKS[level][version - 1];
}

/** 字符计数指示符的位数（字节模式） */
function charCountBits(version) {
	return version < 10 ? 8 : 16;
}

/** 选择能容纳指定字节数的最小版本 */
function chooseVersion(byteLength, level) {
	for (let version = 1; version <= 10; version++) {
		const capacityBits = numDataCodewords(version, level) * 8;
		const neededBits = 4 + charCountBits(version) + byteLength * 8;
		if (neededBits <= capacityBits) {
			return version;
		}
	}
	throw new Error("内容过长，无法生成二维码");
}

/* ------------------------------ 纠错编码 ------------------------------ */

/** GF(2^8) 乘法 */
function gfMultiply(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z & 0xff;
}

/** 计算生成多项式 */
function rsDivisor(degree) {
	const result = new Array(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < result.length) {
				result[j] ^= result[j + 1];
			}
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

/** 计算纠错码字 */
function rsRemainder(data, divisor) {
	const result = new Array(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ result.shift();
		result.push(0);
		for (let i = 0; i < divisor.length; i++) {
			result[i] ^= gfMultiply(divisor[i], factor);
		}
	}
	return result;
}

/** 数据码字 -> 带纠错的最终码字序列 */
function addEccAndInterleave(data, version, level) {
	const numBlocks = ECC_BLOCKS[level][version - 1];
	const blockEccLength = ECC_PER_BLOCK[level][version - 1];
	const rawCodewords = TOTAL_CODEWORDS[version - 1];
	const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
	const shortBlockLength = Math.floor(rawCodewords / numBlocks);
	const divisor = rsDivisor(blockEccLength);

	const blocks = [];
	let offset = 0;
	for (let i = 0; i < numBlocks; i++) {
		const dataLength = shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1);
		const dataPart = data.slice(offset, offset + dataLength);
		offset += dataLength;
		const eccPart = rsRemainder(dataPart, divisor);
		if (i < numShortBlocks) {
			dataPart.push(0);
		}
		blocks.push(dataPart.concat(eccPart));
	}

	const result = [];
	for (let i = 0; i < blocks[0].length; i++) {
		for (let j = 0; j < blocks.length; j++) {
			if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) {
				result.push(blocks[j][i]);
			}
		}
	}
	return result;
}

/** 构造数据码字 */
function buildDataCodewords(bytes, version, level) {
	const capacityBits = numDataCodewords(version, level) * 8;
	const bits = [];
	const pushBits = (value, length) => {
		for (let i = length - 1; i >= 0; i--) {
			bits.push((value >>> i) & 1);
		}
	};

	pushBits(0x4, 4); // 字节模式
	pushBits(bytes.length, charCountBits(version));
	for (const byte of bytes) {
		pushBits(byte, 8);
	}
	// 结束符
	pushBits(0, Math.min(4, capacityBits - bits.length));
	// 补齐到字节
	pushBits(0, (8 - (bits.length % 8)) % 8);
	// 填充字节
	for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
		pushBits(pad, 8);
	}

	const codewords = [];
	for (let i = 0; i < bits.length; i += 8) {
		let value = 0;
		for (let j = 0; j < 8; j++) {
			value = (value << 1) | bits[i + j];
		}
		codewords.push(value);
	}
	return codewords;
}

/* ------------------------------ 矩阵构造 ------------------------------ */

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function getBit(value, index) {
	return ((value >>> index) & 1) !== 0;
}

/** 生成某个掩码下的矩阵 */
function buildMatrix(codewords, version, level, mask) {
	const size = version * 4 + 17;
	const modules = Array.from({ length: size }, () => new Array(size).fill(false));
	const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

	const setFunctionModule = (x, y, isDark) => {
		modules[y][x] = isDark;
		isFunction[y][x] = true;
	};

	const drawFinderPattern = (x, y) => {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				const xx = x + dx;
				const yy = y + dy;
				if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
					setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
				}
			}
		}
	};

	const drawAlignmentPattern = (x, y) => {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	};

	const drawFormatBits = () => {
		const data = (ECC_FORMAT_BITS[level] << 3) | mask;
		let rem = data;
		for (let i = 0; i < 10; i++) {
			rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		}
		const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;

		for (let i = 0; i <= 5; i++) {
			setFunctionModule(8, i, getBit(bits, i));
		}
		setFunctionModule(8, 7, getBit(bits, 6));
		setFunctionModule(8, 8, getBit(bits, 7));
		setFunctionModule(7, 8, getBit(bits, 8));
		for (let i = 9; i < 15; i++) {
			setFunctionModule(14 - i, 8, getBit(bits, i));
		}

		for (let i = 0; i < 8; i++) {
			setFunctionModule(size - 1 - i, 8, getBit(bits, i));
		}
		for (let i = 8; i < 15; i++) {
			setFunctionModule(8, size - 15 + i, getBit(bits, i));
		}
		setFunctionModule(8, size - 8, true);
	};

	// 定时图案（先画，稍后会被定位图案覆盖）
	for (let i = 0; i < size; i++) {
		setFunctionModule(6, i, i % 2 === 0);
		setFunctionModule(i, 6, i % 2 === 0);
	}

	// 定位图案
	drawFinderPattern(3, 3);
	drawFinderPattern(size - 4, 3);
	drawFinderPattern(3, size - 4);

	// 对齐图案
	const positions = ALIGNMENT_POSITIONS[version - 1];
	const count = positions.length;
	for (let i = 0; i < count; i++) {
		for (let j = 0; j < count; j++) {
			if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) {
				continue;
			}
			drawAlignmentPattern(positions[i], positions[j]);
		}
	}

	// 版本信息
	if (version >= 7) {
		let rem = version;
		for (let i = 0; i < 12; i++) {
			rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		}
		const bits = (version << 12) | rem;
		for (let i = 0; i < 18; i++) {
			const bit = getBit(bits, i);
			const a = size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			setFunctionModule(a, b, bit);
			setFunctionModule(b, a, bit);
		}
	}

	drawFormatBits();

	// 填充数据（之字形）
	let bitIndex = 0;
	const totalBits = codewords.length * 8;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) {
			right = 5;
		}
		for (let vert = 0; vert < size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vert : vert;
				if (!isFunction[y][x] && bitIndex < totalBits) {
					modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
					bitIndex++;
				}
			}
		}
	}

	// 掩码
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (isFunction[y][x]) {
				continue;
			}
			let invert;
			switch (mask) {
				case 0:
					invert = (x + y) % 2 === 0;
					break;
				case 1:
					invert = y % 2 === 0;
					break;
				case 2:
					invert = x % 3 === 0;
					break;
				case 3:
					invert = (x + y) % 3 === 0;
					break;
				case 4:
					invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
					break;
				case 5:
					invert = ((x * y) % 2) + ((x * y) % 3) === 0;
					break;
				case 6:
					invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
					break;
				default:
					invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
					break;
			}
			if (invert) {
				modules[y][x] = !modules[y][x];
			}
		}
	}

	return modules;
}

/* ------------------------------ 掩码评分 ------------------------------ */

function finderPenaltyCountPatterns(runHistory) {
	const n = runHistory[1];
	const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
	return (
		(core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
		(core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
	);
}

function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
	if (runHistory[0] === 0) {
		currentRunLength += size;
	}
	runHistory.pop();
	runHistory.unshift(currentRunLength);
}

function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
	if (currentRunColor) {
		finderPenaltyAddHistory(currentRunLength, runHistory, size);
		currentRunLength = 0;
	}
	currentRunLength += size;
	finderPenaltyAddHistory(currentRunLength, runHistory, size);
	return finderPenaltyCountPatterns(runHistory);
}

function getPenaltyScore(modules, size) {
	let result = 0;
	const get = (a, b) => modules[a][b];

	// 规则 1 + 规则 3：行与列
	for (let axis = 0; axis < 2; axis++) {
		for (let i = 0; i < size; i++) {
			let runColor = false;
			let runLength = 0;
			const runHistory = [0, 0, 0, 0, 0, 0, 0];
			for (let j = 0; j < size; j++) {
				const color = axis === 0 ? get(i, j) : get(j, i);
				if (color === runColor) {
					runLength++;
					if (runLength === 5) {
						result += PENALTY_N1;
					} else if (runLength > 5) {
						result++;
					}
				} else {
					finderPenaltyAddHistory(runLength, runHistory, size);
					if (!runColor) {
						result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
					}
					runColor = color;
					runLength = 1;
				}
			}
			result += finderPenaltyTerminateAndCount(runColor, runLength, runHistory, size) * PENALTY_N3;
		}
	}

	// 规则 2：2x2 同色块
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const color = modules[y][x];
			if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
				result += PENALTY_N2;
			}
		}
	}

	// 规则 4：黑白比例
	let dark = 0;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (modules[y][x]) {
				dark++;
			}
		}
	}
	const total = size * size;
	const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
	result += k * PENALTY_N4;
	return result;
}

/* ------------------------------ 对外接口 ------------------------------ */

/**
 * 生成二维码矩阵
 * @param {string} text
 * @param {"L"|"M"} level 纠错等级
 * @returns {{ size: number, modules: boolean[][], version: number, mask: number }}
 */
export function qrEncode(text, level = "M") {
	const bytes = toUtf8Bytes(String(text));
	const version = chooseVersion(bytes.length, level);
	const dataCodewords = buildDataCodewords(bytes, version, level);
	const codewords = addEccAndInterleave(dataCodewords, version, level);
	const size = version * 4 + 17;

	let best = null;
	for (let mask = 0; mask < 8; mask++) {
		const modules = buildMatrix(codewords, version, level, mask);
		const penalty = getPenaltyScore(modules, size);
		if (!best || penalty < best.penalty) {
			best = { modules, penalty, mask };
		}
	}
	return { size, modules: best.modules, version, mask: best.mask };
}

/** 校验位数量（供外部估算用） */
export function qrCapacity(version, level) {
	return numDataCodewords(version, level);
}

export const qrRemainderBits = REMAINDER_BITS;
