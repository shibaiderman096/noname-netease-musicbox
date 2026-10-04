/**
 * 网易云 weapi 加密
 *
 * 流程：明文 -> AES-128-CBC(固定密钥) -> base64 -> AES-128-CBC(随机密钥) -> base64
 *      随机密钥 -> 反转后按字节取大整数 -> RSA -> 十六进制(256位补零)
 *
 * 全部为纯 JS 实现（BigInt + 手写 AES），不依赖 Node 的 crypto，
 * 因此桌面端与浏览器端行为一致。
 */

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const PUB_KEY = "010001";
const MODULUS =
	"00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const SECRET_KEY_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ------------------------------------------------------------------ *
 * AES-128（仅加密，CBC 模式 + PKCS#7 填充）
 * ------------------------------------------------------------------ */

const SBOX = (() => {
	const box = new Uint8Array(256);
	const rotl8 = (x, shift) => ((x << shift) | (x >> (8 - shift))) & 0xff;
	let p = 1;
	let q = 1;
	do {
		p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
		q = (q ^ ((q << 1) & 0xff)) & 0xff;
		q = (q ^ ((q << 2) & 0xff)) & 0xff;
		q = (q ^ ((q << 4) & 0xff)) & 0xff;
		if (q & 0x80) {
			q = (q ^ 0x09) & 0xff;
		}
		const transformed = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
		box[p] = (transformed ^ 0x63) & 0xff;
	} while (p !== 1);
	box[0] = 0x63;
	return box;
})();

const xtime = x => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
const mul = (a, b) => {
	let result = 0;
	let x = a;
	let y = b;
	while (y) {
		if (y & 1) {
			result ^= x;
		}
		x = xtime(x);
		y >>= 1;
	}
	return result & 0xff;
};

/** 密钥扩展，返回 176 字节的轮密钥 */
function expandKey(key) {
	const w = new Uint8Array(176);
	w.set(key.subarray(0, 16), 0);
	let rcon = 1;
	for (let i = 16; i < 176; i += 4) {
		let t0 = w[i - 4];
		let t1 = w[i - 3];
		let t2 = w[i - 2];
		let t3 = w[i - 1];
		if (i % 16 === 0) {
			const first = t0;
			t0 = SBOX[t1] ^ rcon;
			t1 = SBOX[t2];
			t2 = SBOX[t3];
			t3 = SBOX[first];
			rcon = xtime(rcon);
		}
		w[i] = w[i - 16] ^ t0;
		w[i + 1] = w[i - 15] ^ t1;
		w[i + 2] = w[i - 14] ^ t2;
		w[i + 3] = w[i - 13] ^ t3;
	}
	return w;
}

/**
 * 加密一个分组（原地修改 state）
 * state 采用 AES 标准排布：state[4 * 列 + 行]
 */
function encryptBlock(state, w) {
	const addRoundKey = round => {
		const offset = round * 16;
		for (let i = 0; i < 16; i++) {
			state[i] ^= w[offset + i];
		}
	};
	const subBytes = () => {
		for (let i = 0; i < 16; i++) {
			state[i] = SBOX[state[i]];
		}
	};
	const shiftRows = () => {
		const copy = state.slice();
		for (let row = 1; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				state[4 * col + row] = copy[4 * ((col + row) % 4) + row];
			}
		}
	};
	const mixColumns = () => {
		for (let col = 0; col < 4; col++) {
			const i = 4 * col;
			const a0 = state[i];
			const a1 = state[i + 1];
			const a2 = state[i + 2];
			const a3 = state[i + 3];
			state[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
			state[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
			state[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
			state[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
		}
	};

	addRoundKey(0);
	for (let round = 1; round <= 9; round++) {
		subBytes();
		shiftRows();
		mixColumns();
		addRoundKey(round);
	}
	subBytes();
	shiftRows();
	addRoundKey(10);
}

/** UTF-8 编码 */
function toUtf8Bytes(text) {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(text);
	}
	const bytes = [];
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(++i);
			code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
			bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		} else {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}
	return new Uint8Array(bytes);
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
	let result = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		result += B64_CHARS[b0 >> 2];
		result += B64_CHARS[((b0 & 0x03) << 4) | ((b1 || 0) >> 4)];
		result += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | ((b2 || 0) >> 6)] : "=";
		result += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : "=";
	}
	return result;
}

/**
 * AES-128-CBC 加密并返回 base64
 * @param {string} text
 * @param {string} key 16 位字符串密钥
 */
export function aesEncryptBase64(text, key) {
	const data = toUtf8Bytes(text);
	const padLength = 16 - (data.length % 16);
	const padded = new Uint8Array(data.length + padLength);
	padded.set(data, 0);
	padded.fill(padLength, data.length);

	const w = expandKey(toUtf8Bytes(key));
	const iv = toUtf8Bytes(IV);
	const output = new Uint8Array(padded.length);
	let previous = iv;
	for (let offset = 0; offset < padded.length; offset += 16) {
		const block = new Uint8Array(16);
		for (let i = 0; i < 16; i++) {
			block[i] = padded[offset + i] ^ previous[i];
		}
		encryptBlock(block, w);
		output.set(block, offset);
		previous = block;
	}
	return toBase64(output);
}

/* ------------------------------------------------------------------ *
 * RSA
 * ------------------------------------------------------------------ */

/** 模幂运算 */
function modPow(base, exponent, modulus) {
	let result = 1n;
	let b = base % modulus;
	let e = exponent;
	while (e > 0n) {
		if (e & 1n) {
			result = (result * b) % modulus;
		}
		b = (b * b) % modulus;
		e >>= 1n;
	}
	return result;
}

/**
 * RSA 加密（无填充，取反转后密钥的字节大整数）
 * @param {string} text 随机密钥
 * @returns {string} 256 位十六进制字符串
 */
export function rsaEncrypt(text) {
	const reversed = text.split("").reverse().join("");
	let hex = "";
	for (let i = 0; i < reversed.length; i++) {
		hex += reversed.charCodeAt(i).toString(16).padStart(2, "0");
	}
	const message = BigInt("0x" + hex);
	const exponent = BigInt("0x" + PUB_KEY);
	const modulus = BigInt("0x" + MODULUS);
	return modPow(message, exponent, modulus).toString(16).padStart(256, "0");
}

/** 生成 16 位随机密钥 */
export function createSecretKey(size = 16) {
	let key = "";
	for (let i = 0; i < size; i++) {
		key += SECRET_KEY_CHARS[Math.floor(Math.random() * SECRET_KEY_CHARS.length)];
	}
	return key;
}

/**
 * weapi 加密入口
 * @param {Record<string, any>} object 请求参数
 * @returns {{ params: string, encSecKey: string }}
 */
export function weapi(object) {
	const text = JSON.stringify(object);
	const secretKey = createSecretKey(16);
	const params = aesEncryptBase64(aesEncryptBase64(text, PRESET_KEY), secretKey);
	const encSecKey = rsaEncrypt(secretKey);
	return { params, encSecKey };
}
