/**
 * 网易云音乐盒 - 样式
 *
 * 统一使用 nmb- 前缀，避免与无名杀自带样式冲突。
 */
export const MUSIC_BOX_CSS = `
/*
 * 无名杀全局样式里有：div { display:inline-block; position:absolute; transition:all .5s }
 * 这里先把它还原，否则面板里的 div 全部会脱离文档流。
 */
#nmb-root div,
#nmb-root span,
#nmb-root a,
#nmb-root img,
#nmb-root button,
#nmb-root input,
#nmb-root textarea,
#nmb-mini div,
#nmb-mini span,
#nmb-mini button,
#nmb-disc div,
#nmb-disc span,
#nmb-toast div {
	position: static;
	transition: none;
	float: none;
}
#nmb-root div,
#nmb-mini div,
#nmb-disc div {
	display: block;
}

#nmb-root,
#nmb-root *,
#nmb-mini,
#nmb-mini *,
#nmb-disc,
#nmb-disc *,
#nmb-toast {
	box-sizing: border-box;
	font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
	-webkit-user-select: none;
	user-select: none;
}

#nmb-root {
	position: fixed;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	z-index: 2147483000;
	display: none;
	color: #e8e8ea;
}
#nmb-root.nmb-open {
	display: block;
}

#nmb-root .nmb-mask {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	background: rgba(0, 0, 0, 0.45);
}

#nmb-root .nmb-panel {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: 880px;
	height: 620px;
	max-width: 96vw;
	max-height: 94vh;
	background: #202027;
	border: 1px solid #3a3a44;
	border-radius: 10px;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
#nmb-root .nmb-panel.nmb-dragged {
	transform: none;
}

#nmb-root .nmb-head {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 42px;
	padding: 0 10px;
	background: linear-gradient(180deg, #2c2c35, #24242c);
	/* 手机端：拖标题栏时不要触发页面滚动/选择文字 */
	touch-action: none;
	user-select: none;
	border-bottom: 1px solid #383842;
	cursor: move;
	flex: none;
}
#nmb-root .nmb-logo {
	font-size: 18px;
}
#nmb-root .nmb-title {
	font-size: 15px;
	font-weight: bold;
	color: #fff;
	letter-spacing: 1px;
}
#nmb-root .nmb-account {
	font-size: 12px;
	color: #9a9aa2;
	margin-left: 6px;
	max-width: 240px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-account.nmb-online {
	color: #6ecf7a;
}
#nmb-root .nmb-spacer {
	flex: 1;
}

#nmb-root .nmb-btn {
	appearance: none;
	-webkit-appearance: none;
	border: 1px solid #4a4a56;
	background: #2f2f3a;
	color: #e8e8ea;
	border-radius: 5px;
	padding: 4px 10px;
	font-size: 12px;
	line-height: 18px;
	cursor: pointer;
	outline: none;
	transition: background 0.15s, border-color 0.15s;
	white-space: nowrap;
}
#nmb-root .nmb-btn:hover,
#nmb-mini .nmb-btn:hover {
	background: #3b3b48;
	border-color: #65657a;
}
#nmb-root .nmb-btn:active {
	background: #454555;
}
#nmb-root .nmb-btn.nmb-primary {
	background: #ec4141;
	border-color: #ec4141;
	color: #fff;
}
#nmb-root .nmb-btn.nmb-primary:hover {
	background: #ff5252;
	border-color: #ff5252;
}
#nmb-root .nmb-btn.nmb-icon {
	width: 28px;
	height: 26px;
	padding: 0;
	font-size: 13px;
	line-height: 24px;
	text-align: center;
}
#nmb-root .nmb-btn.nmb-play {
	width: 38px;
	height: 34px;
	font-size: 16px;
	line-height: 30px;
	padding: 0;
	border-radius: 50%;
	background: #ec4141;
	border-color: #ec4141;
	color: #fff;
}
#nmb-root .nmb-btn.nmb-active {
	background: #ec4141;
	border-color: #ec4141;
	color: #fff;
}

#nmb-root .nmb-body {
	flex: 1;
	display: flex;
	min-height: 0;
}

#nmb-root .nmb-side {
	width: 148px;
	flex: none;
	background: #1b1b21;
	border-right: 1px solid #33333d;
	padding: 8px 6px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	overflow-y: auto;
}
#nmb-root .nmb-sidebtn {
	appearance: none;
	border: none;
	background: transparent;
	color: #c9c9d1;
	text-align: left;
	padding: 9px 12px;
	border-radius: 6px;
	font-size: 13px;
	cursor: pointer;
	white-space: nowrap;
}
#nmb-root .nmb-sidebtn:hover {
	background: #2b2b35;
	color: #fff;
}
#nmb-root .nmb-sidebtn.nmb-active {
	background: #34343f;
	color: #fff;
	font-weight: bold;
	box-shadow: inset 3px 0 0 #ec4141;
}
#nmb-root .nmb-sidetip {
	margin-top: auto;
	font-size: 11px;
	color: #6f6f7c;
	line-height: 16px;
	padding: 6px 10px;
}

#nmb-root .nmb-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-width: 0;
}

#nmb-root .nmb-toolbar {
	flex: none;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-bottom: 1px solid #2f2f38;
	flex-wrap: wrap;
	min-height: 48px;
}
#nmb-root .nmb-toolbar .nmb-title2 {
	font-size: 14px;
	font-weight: bold;
	color: #fff;
	margin-right: 4px;
}
#nmb-root .nmb-toolbar .nmb-sub {
	font-size: 12px;
	color: #83838f;
}
#nmb-root .nmb-input {
	appearance: none;
	background: #17171c;
	border: 1px solid #3d3d49;
	border-radius: 5px;
	color: #e8e8ea;
	padding: 5px 10px;
	font-size: 13px;
	outline: none;
	-webkit-user-select: text;
	user-select: text;
}
#nmb-root .nmb-input:focus {
	border-color: #ec4141;
}
#nmb-root textarea.nmb-input {
	resize: none;
	width: 100%;
	height: 62px;
	font-size: 12px;
	line-height: 17px;
	font-family: Consolas, Menlo, monospace;
}
#nmb-root .nmb-grow {
	flex: 1;
	min-width: 80px;
}

#nmb-root .nmb-list {
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 6px 8px 12px;
	min-height: 0;
}
#nmb-root .nmb-list::-webkit-scrollbar,
#nmb-root .nmb-side::-webkit-scrollbar {
	width: 8px;
}
#nmb-root .nmb-list::-webkit-scrollbar-thumb,
#nmb-root .nmb-side::-webkit-scrollbar-thumb {
	background: #45454f;
	border-radius: 4px;
}

#nmb-root .nmb-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 10px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
	color: #dcdce2;
}
#nmb-root .nmb-item:hover {
	background: #2d2d37;
}
#nmb-root .nmb-item.nmb-current {
	background: #3a2a2d;
	color: #ff8a8a;
}
#nmb-root .nmb-index {
	width: 26px;
	flex: none;
	text-align: right;
	color: #77777f;
	font-size: 12px;
}
#nmb-root .nmb-item.nmb-current .nmb-index {
	color: #ff8a8a;
}
#nmb-root .nmb-name {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-tag {
	font-size: 10px;
	color: #ffb400;
	border: 1px solid #8a6a1f;
	border-radius: 3px;
	padding: 0 3px;
	margin-left: 4px;
}
#nmb-root .nmb-artist2 {
	width: 190px;
	flex: none;
	color: #8f8f9b;
	font-size: 12px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-album {
	width: 150px;
	flex: none;
	color: #77777f;
	font-size: 12px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-duration {
	width: 46px;
	flex: none;
	text-align: right;
	color: #77777f;
	font-size: 12px;
}

#nmb-root .nmb-card {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	border-radius: 6px;
	cursor: pointer;
}
#nmb-root .nmb-card:hover {
	background: #2d2d37;
}
#nmb-root .nmb-card img {
	width: 46px;
	height: 46px;
	border-radius: 5px;
	flex: none;
	background: #33333d;
	object-fit: cover;
}
#nmb-root .nmb-card .nmb-cardinfo {
	flex: 1;
	min-width: 0;
}
#nmb-root .nmb-card .nmb-cardname {
	font-size: 13px;
	color: #e8e8ea;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-card .nmb-cardmeta {
	font-size: 11px;
	color: #83838f;
	margin-top: 3px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-card .nmb-cardopt {
	flex: none;
	display: flex;
	gap: 6px;
}

#nmb-root .nmb-empty {	padding: 40px 20px;
	text-align: center;
	color: #7c7c88;
	font-size: 13px;
	line-height: 22px;
}
#nmb-root .nmb-loading {
	padding: 26px;
	text-align: center;
	color: #9a9aa2;
	font-size: 13px;
}

/* ---------- 歌词视图 ---------- */
#nmb-root .nmb-lyric {
	display: flex;
	flex-direction: column;
	height: 100%;
	padding: 10px 6px 6px;
	box-sizing: border-box;
}
#nmb-root .nmb-lyric-head {
	flex: none;
	text-align: center;
	color: #cfcfd6;
	font-size: 12px;
	padding: 4px 10px 10px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
#nmb-root .nmb-lyric-body {
	flex: 1 1 auto;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 0 12px;
	text-align: center;
	-webkit-overflow-scrolling: touch;
}
#nmb-root .nmb-lyric-line {
	display: block;
	position: static;
	padding: 7px 4px;
	color: #85858f;
	font-size: 13px;
	line-height: 20px;
	cursor: pointer;
	transition: color 0.25s;
	word-break: break-word;
}
#nmb-root .nmb-lyric-line:hover {
	color: #c8c8d0;
}
#nmb-root .nmb-lyric-line.nmb-active {
	color: #ec4141;
	font-size: 15px;
	font-weight: 600;
	text-shadow: 0 0 12px rgba(236, 65, 65, 0.35);
}
#nmb-root .nmb-lyric-tip {
	flex: none;
	text-align: center;
	color: #5f5f6a;
	font-size: 11px;
	padding-top: 6px;
}
#nmb-root .nmb-ctrl .nmb-btn.nmb-on {
	background: #ec4141;
	border-color: #ec4141;
	color: #fff;
}

#nmb-root .nmb-foot {
	flex: none;
	display: flex;
	align-items: center;
	gap: 10px;
	height: 66px;
	padding: 0 12px;
	background: #1b1b21;
	border-top: 1px solid #33333d;
}
#nmb-root .nmb-cover {
	width: 46px;
	height: 46px;
	border-radius: 5px;
	flex: none;
	background: #2c2c35 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='46' height='46'><text x='50%' y='58%' font-size='20' text-anchor='middle' fill='%23555560'>♪</text></svg>") center/cover no-repeat;
	background-size: cover;
}
#nmb-root .nmb-meta {
	width: 160px;
	flex: none;
	overflow: hidden;
}
#nmb-root .nmb-song {
	font-size: 13px;
	color: #f0f0f4;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-artist {
	font-size: 11px;
	color: #83838f;
	margin-top: 3px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#nmb-root .nmb-ctrl {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: none;
}
#nmb-root .nmb-progress {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 120px;
}
#nmb-root .nmb-progress span {
	font-size: 11px;
	color: #83838f;
	width: 38px;
	text-align: center;
	flex: none;
}
#nmb-root input[type="range"] {
	appearance: none;
	-webkit-appearance: none;
	height: 4px;
	border-radius: 2px;
	background: #45454f;
	outline: none;
	cursor: pointer;
	flex: 1;
	min-width: 60px;
	margin: 0;
}
#nmb-root input[type="range"]::-webkit-slider-thumb {
	appearance: none;
	-webkit-appearance: none;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: #ec4141;
	border: 2px solid #fff;
}
#nmb-root .nmb-vol {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 110px;
	flex: none;
	font-size: 12px;
	color: #83838f;
}

#nmb-root .nmb-login {
	padding: 14px;
	font-size: 13px;
	line-height: 22px;
	color: #c9c9d1;
}
#nmb-root .nmb-block {
	background: #26262f;
	border: 1px solid #35353f;
	border-radius: 8px;
	padding: 12px 14px;
	margin-bottom: 12px;
}
#nmb-root .nmb-block h4 {
	margin: 0 0 8px;
	font-size: 13px;
	color: #fff;
	font-weight: bold;
}
#nmb-root .nmb-row {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
	flex-wrap: wrap;
}
#nmb-root .nmb-hint {
	font-size: 11px;
	color: #83838f;
	line-height: 18px;
	margin-top: 6px;
}
#nmb-root .nmb-hint code {
	background: #17171c;
	border-radius: 3px;
	padding: 0 4px;
	color: #d0a0a0;
	font-family: Consolas, Menlo, monospace;
	-webkit-user-select: text;
	user-select: text;
}
#nmb-root .nmb-qr {
	display: flex;
	align-items: center;
	gap: 14px;
	margin-top: 10px;
}
#nmb-root .nmb-qr canvas {
	width: 168px;
	height: 168px;
	background: #fff;
	border-radius: 6px;
	padding: 6px;
	flex: none;
}
#nmb-root .nmb-qr .nmb-qrstatus {
	font-size: 12px;
	color: #9a9aa2;
	line-height: 20px;
	max-width: 260px;
}

#nmb-root .nmb-tip {
	position: absolute;
	left: 50%;
	bottom: 84px;
	transform: translateX(-50%);
	background: rgba(20, 20, 24, 0.94);
	border: 1px solid #45454f;
	color: #fff;
	font-size: 12px;
	padding: 7px 14px;
	border-radius: 6px;
	max-width: 70%;
	text-align: center;
	opacity: 0;
	transition: opacity 0.2s;
	pointer-events: none;
}
#nmb-root .nmb-tip.nmb-show {
	opacity: 1;
}

#nmb-mini {
	position: fixed;
	right: 14px;
	bottom: 14px;
	z-index: 2147482999;
	display: none;
	align-items: center;
	gap: 8px;
	background: rgba(26, 26, 32, 0.95);
	border: 1px solid #3f3f4b;
	border-radius: 22px;
	padding: 6px 12px 6px 8px;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
	color: #e8e8ea;
	max-width: 62vw;
	cursor: move;
	transition: none;
	/* 手机端：拖动时不要让页面滚动手势抢走指针 */
	touch-action: none;
}
#nmb-mini.nmb-show {
	display: flex;
}
#nmb-mini.nmb-dragged,
#nmb-disc.nmb-dragged {
	right: auto;
	bottom: auto;
}
#nmb-mini .nmb-mini-cover {
	width: 30px;
	height: 30px;
	border-radius: 50%;
	background: #2c2c35 center/cover no-repeat;
	flex: none;
	pointer-events: none;
}
#nmb-mini .nmb-mini-text {
	font-size: 12px;
	max-width: 260px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	pointer-events: none;
}
#nmb-mini .nmb-btn {
	appearance: none;
	border: none;
	background: transparent;
	color: #e8e8ea;
	font-size: 14px;
	cursor: pointer;
	padding: 2px 4px;
	border-radius: 4px;
	line-height: 20px;
}
#nmb-mini .nmb-btn:hover {
	background: #3b3b48;
}
#nmb-mini .nmb-mini-fold {
	font-size: 12px;
	opacity: 0.75;
}

/* ---------- 无操作后收起的圆形唱片 ---------- */
#nmb-disc {
	position: fixed;
	right: 14px;
	bottom: 14px;
	width: 64px;
	height: 64px;
	z-index: 2147482999;
	display: none;
	cursor: pointer;
	filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.55));
	transition: none;
	/* 手机端：允许拖动圆盘而不触发页面滚动 */
	touch-action: none;
}
#nmb-disc.nmb-show {
	display: block;
}
#nmb-disc .nmb-disc-vinyl {
	position: relative;
	width: 100%;
	height: 100%;
	border-radius: 50%;
	border: 1px solid #45454f;
	background:
		radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.06) 0 30%, rgba(0, 0, 0, 0) 31%),
		repeating-radial-gradient(circle at 50% 50%, #14141a 0 2px, #1e1e26 2px 4px);
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}
#nmb-disc .nmb-disc-cover {
	width: 44%;
	height: 44%;
	border-radius: 50%;
	background: #ec4141 center/cover no-repeat;
	border: 1px solid rgba(255, 255, 255, 0.28);
	box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.35);
}
#nmb-disc .nmb-disc-hole {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 7px;
	height: 7px;
	margin: -3.5px 0 0 -3.5px;
	border-radius: 50%;
	background: #0c0c10;
	border: 1px solid #4a4a55;
}
#nmb-disc.nmb-playing .nmb-disc-vinyl {
	animation: nmb-spin 9s linear infinite;
}
#nmb-disc .nmb-disc-tip {
	position: absolute;
	right: 2px;
	bottom: -2px;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: #ec4141;
	color: #fff;
	font-size: 10px;
	line-height: 16px;
	text-align: center;
	border: 1px solid #1b1b21;
}
@keyframes nmb-spin {
	from {
		transform: rotate(0deg);
	}
	to {
		transform: rotate(360deg);
	}
}

#nmb-toast {
	position: fixed;
	left: 50%;
	top: 60px;
	transform: translateX(-50%);
	z-index: 2147483600;
	background: rgba(20, 20, 24, 0.95);
	border: 1px solid #ec4141;
	color: #fff;
	font-size: 13px;
	line-height: 20px;
	padding: 10px 18px;
	border-radius: 8px;
	max-width: 70vw;
	display: none;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
#nmb-toast.nmb-show {
	display: block;
}
`;
