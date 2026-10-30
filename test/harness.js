/**
 * Local checks for the Vaughn Live Grayjay source.
 *
 *   node test/harness.js
 *
 * Grayjay itself is not running here. The harness provides the same globals
 * the script uses (source, Http-shaped http, platform types) and then calls
 * the plugin methods. Live checks talk to vaughn.live's API, HLS hosts, and
 * chat socket. Live getHome and search fail the run when vaughn.live does
 * not return the real pages.
 *
 * Node 22 provides a global WebSocket. Node 20 needs:
 *   node --experimental-websocket test/harness.js
 * The harness also accepts undici.WebSocket or the ws package.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
let failed = 0;

function loadWebSocket() {
	if (typeof WebSocket === "function") return WebSocket;
	try {
		const undici = require("undici");
		if (typeof undici.WebSocket === "function") return undici.WebSocket;
	} catch (e) {}
	try {
		const WS = require("ws");
		if (typeof WS === "function") return WS;
	} catch (e) {}
	console.error("WebSocket is not available. On Node 20 run: node --experimental-websocket test/harness.js");
	process.exit(1);
}

const SocketImpl = loadWebSocket();

function pass(name) {
	console.log("PASS", name);
}

function fail(name, detail) {
	failed += 1;
	console.error("FAIL", name, detail || "");
}

function assert(cond, name, detail) {
	if (cond) pass(name);
	else fail(name, detail);
}

class ScriptException extends Error {
	constructor(message) {
		super(message);
		this.name = "ScriptException";
	}
}
class UnavailableException extends Error {
	constructor(message) {
		super(message);
		this.name = "UnavailableException";
	}
}
class PlatformID {
	constructor(platform, id, pluginId) {
		this.platform = platform;
		this.id = id;
		this.pluginId = pluginId;
	}
}
class Thumbnails {
	constructor(items) { this.items = items || []; }
}
class Thumbnail {
	constructor(url, quality) { this.url = url; this.quality = quality; }
}
class PlatformAuthorLink {
	constructor(id, name, url, thumbnail) {
		this.id = id;
		this.name = name;
		this.url = url;
		this.thumbnail = thumbnail;
	}
}
function bag(kind) {
	return class {
		constructor(obj) {
			Object.assign(this, obj || {});
			this.kind = kind;
		}
	};
}
const PlatformVideo = bag("video");
const PlatformVideoDetails = bag("details");
const PlatformChannel = bag("channel");
class VideoPager {
	constructor(results, hasMore, context) {
		this.results = results || [];
		this.hasMore = !!hasMore;
		this.context = context || {};
	}
}
class ChannelPager extends VideoPager {}
class CommentPager extends VideoPager {}
class LiveEventPager extends VideoPager {}
class LiveEventComment {
	constructor(name, message, thumbnail) {
		this.name = name;
		this.message = message;
		this.thumbnail = thumbnail;
		this.eventType = "comment";
	}
}
class LiveEventViewCount {
	constructor(count) {
		this.count = count;
		this.eventType = "viewers";
	}
}
class HLSSource {
	constructor(obj) { Object.assign(this, obj || {}); }
}
class VideoUrlSource {
	constructor(obj) { Object.assign(this, obj || {}); }
}
class VideoSourceDescriptor {
	constructor(sources) { this.sources = sources || []; }
}
const Type = { Feed: { Mixed: "MIXED", Videos: "VIDEOS" } };

const http = {
	GET(_url, _headers, _auth) {
		throw new Error("http.GET was not stubbed");
	},
	socket() {
		throw new Error("http.socket was not stubbed");
	},
	batch() {
		const calls = [];
		const builder = {
			GET(url, headers, auth) { calls.push([url, headers, auth]); return builder; },
			execute() { return calls.map((c) => http.GET(c[0], c[1], c[2])); },
		};
		return builder;
	},
};

const sandbox = {
	source: {},
	http,
	console,
	ScriptException,
	UnavailableException,
	PlatformID,
	Thumbnails,
	Thumbnail,
	PlatformAuthorLink,
	PlatformVideo,
	PlatformVideoDetails,
	PlatformChannel,
	VideoPager,
	ChannelPager,
	CommentPager,
	LiveEventPager,
	LiveEventComment,
	LiveEventViewCount,
	HLSSource,
	VideoUrlSource,
	VideoSourceDescriptor,
	Type,
	TextDecoder,
	Uint8Array,
	Date,
	Math,
	parseInt,
	encodeURIComponent,
	setTimeout,
	clearTimeout,
	WebSocket: SocketImpl,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "VaughnLiveScript.js"), "utf8"), sandbox, { filename: "VaughnLiveScript.js" });
sandbox.source.enable({ id: "test-plugin" });

function b64(text) {
	return Buffer.from(text, "utf8").toString("base64");
}

function unitTests() {
	const html = fs.readFileSync(path.join(__dirname, "fixtures", "home-cards.html"), "utf8");
	const videos = sandbox.extractFrontpageStreams(html);
	assert(videos.length === 2, "frontpage fixture yields two cards", "got " + videos.length);
	assert(videos[0] && videos[0].author && videos[0].author.name === "bobbymagicradio2", "first card channel");
	assert(videos[0] && videos[0].name === "1976 today", "first card title");
	assert(videos[0] && videos[0].viewCount === 11, "first card viewers", videos[0] && videos[0].viewCount);
	assert(videos[1] && videos[1].url === "https://vaughn.live/monkeywithkeys", "second card url");
	assert(videos[0] && videos[0].isLive === true, "frontpage cards are live");

	const relative = sandbox.extractFrontpageStreams(
		'<div id="vs_v9_frontpage_streams_box-x"><a href="/citycam"><img src="https://thumbnails.vaughnsoft.net/1_0/fetch/live/citycam.webp">' +
		'<div class="vs_v9_frontpage_streams_duration">3 Viewers</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">citycam</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">Nashville</div></a></div>'
	);
	assert(relative.length === 1 && relative[0].url === "https://vaughn.live/citycam", "relative homepage href");

	const slug = sandbox.slugFromUrl;
	assert(slug("https://vaughn.live/totally_70s") === "totally_70s", "channel url");
	assert(slug("https://vaughn.live/totally_70s/") === "totally_70s", "trailing slash");
	assert(slug("https://www.vaughn.live/totally_70s?x=1") === "totally_70s", "query string");
	assert(slug("https://vaughn.live/totally_70s/vod") === "", "extra path rejected");
	assert(slug("https://vaughn.live/browse") === "", "reserved slug rejected");
	assert(slug("https://vaughn.live/events") === "", "events page is not a channel");
	assert(sandbox.decodeEntities("&#128226; Upcoming Events from Vaughn Live! &#129395;") === "\uD83D\uDCE2 Upcoming Events from Vaughn Live! \uD83E\uDD73", "numeric html entities");
	assert(sandbox.decodeEntities("DJ &amp; Friends") === "DJ & Friends", "named html entities");
	assert(sandbox.decodeVaughnText(b64("Tip #064 host")) === "Tip@host", "description keeps site character codes");
	const mixed = sandbox.extractFrontpageStreams(
		'<div id="vs_v9_frontpage_streams_box-e"><a href="/events">' +
		'<div class="vs_v9_frontpage_streams_duration">5 Viewers</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">events</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">&#128226; Upcoming Events from Vaughn Live! &#129395;</div></a></div>' +
		'<div id="vs_v9_frontpage_streams_box-c"><a href="/citycam">' +
		'<div class="vs_v9_frontpage_streams_duration">3 Viewers</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">DJ &amp; Friends</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">&#128226; Nashville</div></a></div>'
	);
	assert(mixed.length === 1 && mixed[0].url === "https://vaughn.live/citycam", "events card is omitted", mixed.map((item) => item.url).join(" "));
	assert(mixed[0] && mixed[0].author.name === "DJ & Friends" && mixed[0].name === "\uD83D\uDCE2 Nashville", "home title and channel name are decoded", mixed[0] && (mixed[0].author.name + " | " + mixed[0].name));
	assert(slug("https://example.com/totally_70s") === "", "other host rejected");

	assert(sandbox.decodeVaughnText(b64("Non #045 Stop")) === "Non-Stop", "status hyphen code");
	assert(sandbox.decodeVaughnText(b64("24 #047 7")) === "24/7", "status slash code");
	http.GET = function (url) {
		if (String(url).indexOf("api.vaughnsoft.net") >= 0) {
			return { isOk: true, code: 200, body: JSON.stringify({ status: 200, live: true, viewers: "3", followers: "1", pageviews: "9", lastlive: "1" }) };
		}
		return { isOk: false, code: 444, body: "" };
	};
	const fallback = sandbox.source.getContentDetails("https://vaughn.live/citycam");
	assert(fallback.live && fallback.live.url === "https://stream-cdn-iad3.vaughnsoft.net/play/live_citycam.flv", "no playlist plays flv as the live source", fallback.live && fallback.live.url);
	assert(fallback.video.sources.length === 1 && /\/vl\/citycam\.m3u8$/.test(fallback.video.sources[0].url), "cold channel offers hls as the alternate", fallback.video.sources[0] && fallback.video.sources[0].url);

	const playlistWith = (n) => "#EXTM3U\n#EXT-X-VERSION:3\n" + Array.from({ length: n }, (_, i) => "#EXTINF:2.000, no desc\nhttps://s3.vaughnsoft.net/live/live_citycam-" + i + ".ts\n").join("");
	const stubPlaylists = (counts) => {
		http.GET = function (url) {
			if (String(url).indexOf("api.vaughnsoft.net") >= 0) {
				return { isOk: true, code: 200, body: JSON.stringify({ status: 200, live: true, viewers: "3", followers: "1", pageviews: "9", lastlive: "1" }) };
			}
			const n = String(url).indexOf("gateway33") >= 0 ? counts[0] : counts[1];
			return n < 0 ? { isOk: false, code: 444, body: "" } : { isOk: true, code: 200, body: playlistWith(n) };
		};
	};
	stubPlaylists([1, 1]);
	const thin = sandbox.source.getContentDetails("https://vaughn.live/citycam");
	assert(thin.live && /\.flv$/.test(thin.live.url), "thin playlists (1 segment) are skipped", thin.live && thin.live.url);
	stubPlaylists([3, -1]);
	const ready = sandbox.source.getContentDetails("https://vaughn.live/citycam");
	assert(ready.live && /gateway33.*\/vl\/citycam\.m3u8$/.test(ready.live.url), "ready playlist plays hls", ready.live && ready.live.url);
	assert(ready.video.sources.length === 1 && /\.flv$/.test(ready.video.sources[0].url), "flv is offered as the alternate", ready.video.sources[0] && ready.video.sources[0].url);
	stubPlaylists([2, 5]);
	const deeper = sandbox.source.getContentDetails("https://vaughn.live/citycam");
	assert(deeper.live && /clutch/.test(deeper.live.url), "deepest playlist wins", deeper.live && deeper.live.url);
	stubPlaylists([-1, -1]);
	const upper = sandbox.source.getContentDetails("https://vaughn.live/CityCam");
	assert(upper.live && upper.live.url === "https://stream-cdn-iad3.vaughnsoft.net/play/live_citycam.flv", "mixed-case link uses the lowercase slug", upper.live && upper.live.url);
	assert(slug("https://vaughn.live/TotallY_70s") === "totally_70s", "mixed-case channel url");
	assert(sandbox.chatServerFor("rootreview") === "chat-ws-1x06.vaughnsoft.net" && sandbox.chatServerFor("RootReview") === "chat-ws-1x06.vaughnsoft.net", "chat server pick ignores case");

	const caps = sandbox.source.getSearchCapabilities();
	assert(caps.types && caps.types[0] === Type.Feed.Mixed, "search capabilities");

	const following = [
		"stream_category=1,stream_name=totally_70s,stream_label=Totally 70s,stream_viewers=9,stream_title=" + b64("Hi") + ",stream_status=live",
		"stream_category=1,stream_name=tech_corner,stream_label=Tech,stream_viewers=5,stream_title=" + b64("Help") + ",stream_status=offair",
	].join(";");
	http.GET = function (url, _headers, auth) {
		assert(auth === true, "subscriptions use the auth client");
		assert(String(url).indexOf("content_menu.php?a=following") >= 0, "subscriptions URL");
		return { isOk: true, code: 200, body: Buffer.from(following, "utf8").toString("base64") };
	};
	const subs = sandbox.source.getUserSubscriptions();
	assert(subs.length === 2 && subs[0] === "https://vaughn.live/totally_70s" && subs[1] === "https://vaughn.live/tech_corner", "subscription import", JSON.stringify(subs));

	http.GET = function () {
		return { isOk: true, code: 200, body: "-1" };
	};
	assert(sandbox.source.getUserSubscriptions().length === 0, "logged-out following list");

	const searchBody = Buffer.from(JSON.stringify([{ search_query: "radio", streams: [
		{ name: "totally_70s", live: true },
		{ name: "mark", live: false },
		{ name: "browse", live: false },
	] }]), "utf8").toString("base64");
	http.GET = function (url) {
		const u = String(url);
		if (u.indexOf("search.php") >= 0) return { isOk: true, code: 200, body: searchBody };
		if (u.indexOf("/v1/stream/vl/totally_70s") >= 0) {
			return { isOk: true, code: 200, body: JSON.stringify({
				status: 200, live: true, viewers: "9", pageviews: "10", followers: "3",
				lastlive: "1792897500", status_msg: b64("On air"), about_msg: "", chat_server: "chat.example",
				profile_img: "https://cdn.vaughnsoft.net/profile/0/totally_70s.jpg", webrtc: false, is_mature: false,
			}) };
		}
		if (u.indexOf("/v1/stream/vl/mark") >= 0) {
			return { isOk: true, code: 200, body: JSON.stringify({
				status: 200, live: false, viewers: "0", pageviews: "10", followers: "3",
				lastlive: "1792600000", status_msg: b64("Off"), about_msg: "", chat_server: "chat.example",
			}) };
		}
		return { isOk: false, code: 404, body: "" };
	};
	const found = sandbox.source.search("radio!");
	assert(found.results.length === 2, "search drops reserved slugs and enriches", "got " + found.results.length);
	assert(found.results[0].isLive === true && found.results[1].isLive === false, "search live flags");
	assert(sandbox.source.searchSuggestions("radio").indexOf("totally_70s") >= 0, "search suggestions");
	const channels = sandbox.source.searchChannels("radio");
	assert(channels.results.length === 2 && channels.results[0].url === "https://vaughn.live/totally_70s", "search channels");

	http.socket = function (url) {
		assert(String(url).indexOf("wss://chat.example/mvn") === 0, "chat socket url", url);
		return {
			connect(handlers) {
				this.handlers = handlers;
				handlers.open();
			},
			send(data) {
				const text = String(data);
				if (text.indexOf("MVN AUTH ") === 0) this.handlers.message("ACK Guest_1;CadetBlue;0\0");
				if (text.indexOf("JOIN ") === 0) {
					this.handlers.message("kirbykrazy2;Blue;2;1;vl;0;1;0;0;aa;id;id HISTORY 2026-10-25T03:00:01.703Z #vl-totally_70s :can&#039;t wait\0");
				}
			},
			close() {},
		};
	};
	const chat = sandbox.source.getLiveEvents("https://vaughn.live/totally_70s");
	const page = chat.nextPage();
	const comments = page.results.filter((item) => item.eventType === "comment");
	assert(comments.length === 1 && comments[0].name === "kirbykrazy2" && comments[0].message === "can't wait", "mocked chat history", JSON.stringify(comments));
	const windowDesc = sandbox.source.getLiveChatWindow("https://vaughn.live/totally_70s");
	assert(windowDesc && windowDesc.url === "https://vaughn.live/totally_70s/chat", "live chat window");

	const homeHtml = '<!DOCTYPE html><html><head><title>Vaughn Live - Live stream your life</title>' +
		'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body>' +
		'<div id="vs_v9_frontpage_streams_box-0"><a href="https://vaughn.live/bobbymagicradio2">' +
		'<div class="vs_v9_frontpage_streams_duration">11 Viewers</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">bobbymagicradio2</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">1976 today</div></a></div>' +
		'<div id="vs_v9_frontpage_streams_box-1"><a href="/monkeywithkeys">' +
		'<div class="vs_v9_frontpage_streams_duration">4 Viewers</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">monkeywithkeys</div>' +
		'<div class="vs_v9_frontpage_streams_box_profile_title">Just a moment</div></a></div>' +
		'</body></html>';
	const calls = [];
	let homeHits = 0;
	http.GET = function (url) {
		calls.push(String(url));
		if (String(url).indexOf("favicon.ico") >= 0) return { isOk: true, code: 200, body: "" };
		if (String(url).indexOf("vaughn.live/") >= 0 && String(url).indexOf("app/") < 0) {
			homeHits += 1;
			if (homeHits === 1) return { isOk: false, code: 403, body: "<html><title>Just a moment...</title><p>cf-chl</p></html>" };
			return { isOk: true, code: 200, body: homeHtml };
		}
		return { isOk: false, code: 404, body: "" };
	};
	const home = sandbox.source.getHome();
	assert(home.results.length === 2, "home accepts jsd script after one 403", "got " + home.results.length);
	assert(calls.some((url) => url.indexOf("favicon.ico") >= 0), "403 retry warms up with favicon", calls.join(" "));
	assert(calls.filter((url) => url === "https://vaughn.live/").length === 2, "homepage is retried once", calls.join(" "));
	const recs = sandbox.source.getContentRecommendations("https://vaughn.live/bobbymagicradio2");
	const recUrls = recs.results.map((item) => item.url);
	assert(recUrls.indexOf("https://vaughn.live/monkeywithkeys") >= 0 && recUrls.indexOf("https://vaughn.live/bobbymagicradio2") < 0, "recommendations come from home", recUrls.join(" "));

	http.GET = function () {
		return { isOk: true, code: 200, body: "<html><title>Just a moment...</title></html>" };
	};
	let blocked = false;
	try { sandbox.source.getHome(); } catch (err) { blocked = /challenge/i.test(String(err.message || err)); }
	assert(blocked, "real interstitial is still a challenge");

	let sock = null;
	http.GET = function (url) {
		const u = String(url);
		if (u.indexOf("/v1/stream/vl/totally_70s") >= 0) {
			return { isOk: true, code: 200, body: JSON.stringify({
				status: 200, live: true, viewers: "9", pageviews: "10", followers: "3",
				lastlive: "1792897500", status_msg: b64("On air"), about_msg: "", chat_server: "chat.example",
			}) };
		}
		return { isOk: false, code: 403, body: "Attention Required" };
	};
	http.socket = function () {
		sock = {
			closed: false,
			handlers: null,
			connect(handlers) { this.handlers = handlers; handlers.open(); },
			send(data) {
				if (String(data).indexOf("MVN AUTH ") === 0) this.handlers.message("ACK Guest_1;CadetBlue;0\0");
			},
			close() { this.closed = true; },
		};
		return sock;
	};
	const slow = sandbox.source.getLiveEvents("https://vaughn.live/totally_70s");
	slow.lastFetch = Date.now() - 120000;
	const hist = " HISTORY 2026-10-25T03:00:01.703Z #vl-totally_70s :";
	sock.handlers.message("kirbykrazy2;Blue;1;0;vl;0;1;0;0;a;id;id" + hist + "hello\0");
	sock.handlers.message("vaughn;midnightblue;1;1;null;0;1;0;0;a;id;id" + hist + "-> Todays_Sound left\0");
	sock.handlers.message("vaughn;midnightblue;1;1;null;0;1;0;0;a;id;id" + hist + "-> [ Mod ] DScott750 left\0");
	sock.handlers.message("vaughn;midnightblue;1;1;null;0;1;0;0;a;id;id" + hist + "-> @Justapug -> Weather for San Antonio\0");
	const slowPage = slow.nextPage();
	const slowComments = slowPage.results.filter((item) => item.eventType === "comment");
	assert(!sock.closed, "slow polls do not close chat");
	assert(slowComments.length === 2, "join/leave notices are dropped", JSON.stringify(slowComments));
	assert(slowComments[0].message === "hello" && slowComments[1].message.indexOf("Weather") >= 0, "bot replies stay in chat", JSON.stringify(slowComments));
}

function curlGet(url, headers) {
	const args = ["-sS", "-L", "--max-time", "25", "-w", "\n%{http_code}"];
	const hdrs = headers || {};
	Object.keys(hdrs).forEach((key) => {
		if (hdrs[key] != null) args.push("-H", key + ": " + hdrs[key]);
	});
	args.push(url);
	let out = "";
	try {
		out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
	} catch (err) {
		out = err.stdout ? String(err.stdout) : "";
	}
	const idx = out.lastIndexOf("\n");
	const code = parseInt(out.slice(idx + 1), 10) || 0;
	return { body: idx >= 0 ? out.slice(0, idx) : out, code: code, isOk: code >= 200 && code < 300 };
}

function liveSocket(url) {
	let ws = null;
	return {
		connect(handlers) {
			ws = new sandbox.WebSocket(url);
			ws.addEventListener("open", () => handlers.open && handlers.open());
			ws.addEventListener("message", (ev) => handlers.message && handlers.message(String(ev.data)));
			ws.addEventListener("close", () => handlers.close && handlers.close());
			ws.addEventListener("error", () => handlers.error && handlers.error());
		},
		send(data) {
			if (ws && ws.readyState === 1) ws.send(data);
		},
		close() {
			if (ws) ws.close();
		},
	};
}

function liveTests() {
	http.GET = curlGet;
	http.socket = liveSocket;

	const home = (() => {
		try {
			const pager = sandbox.source.getHome();
			return { ok: true, count: pager.results.length, pager: pager };
		} catch (err) {
			return { ok: false, message: String(err.message || err) };
		}
	})();
	if (home.ok && home.count > 0) {
		pass("live home returned " + home.count + " cards");
		const recs = sandbox.source.getContentRecommendations(home.pager.results[0].url);
		assert(recs.results.length > 0, "live recommendations", recs.results.length);
		assert(recs.results.every((item) => item.url !== home.pager.results[0].url), "live recommendations omit the current stream");
	} else fail("live home", home.ok ? "no cards" : home.message);

	if (home.ok && home.count > 1) {
		const slugs = home.pager.results.map((item) => sandbox.slugFromUrl(item.url)).filter(Boolean);
		const flvHeader = (u) => {
			const out = path.join("/tmp", "vaughn-live-check.bin");
			try { fs.unlinkSync(out); } catch (e) {}
			try { execFileSync("curl", ["-sS", "--max-time", "4", "-A", "Mozilla/5.0", "-H", "Referer: https://vaughn.live/", "-o", out, u], { stdio: "ignore" }); } catch (e) {}
			const head = fs.existsSync(out) ? fs.readFileSync(out).slice(0, 3).toString("latin1") : "";
			try { fs.unlinkSync(out); } catch (e) {}
			return head;
		};
		const checkPlayable = (label, url) => {
			let d;
			try { d = sandbox.source.getContentDetails(url); } catch (err) { fail(label + " details", err.message); return; }
			const liveUrl = d.live && String(d.live.url);
			assert(!!liveUrl, label + " has a live source", liveUrl);
			const alt = d.video.sources[0] && d.video.sources[0].url;
			assert(!!alt && alt !== liveUrl, label + " has an alternate source", alt);
			const flvUrl = /\.flv$/.test(liveUrl) ? liveUrl : alt;
			assert(flvHeader(flvUrl) === "FLV", label + " flv plays (" + (/\.flv$/.test(liveUrl) ? "flv first" : "hls first") + ")", flvUrl);
			return d;
		};
		const popular = slugs[0];
		checkPlayable("popular " + popular, "https://vaughn.live/" + popular);
		const quiet = slugs[slugs.length - 1];
		checkPlayable("quiet " + quiet, "https://vaughn.live/" + quiet);
		const mixedUrl = "https://vaughn.live/" + popular.charAt(0).toUpperCase() + popular.slice(1, -1) + popular.slice(-1).toUpperCase();
		const md = checkPlayable("mixed-case link " + mixedUrl.split("/").pop(), mixedUrl);
		if (md) assert(String(md.live.url + " " + md.video.sources[0].url).indexOf(popular) >= 0, "mixed-case link resolves to the lowercase stream");
		let agree = 0, checked = 0;
		slugs.slice(0, 15).concat(["tech_corner", "community", "mark"]).forEach((sl) => {
			const r = curlGet("https://api.vaughnsoft.net/v1/stream/vl/" + sl);
			let cs = "";
			try { cs = JSON.parse(r.body).chat_server || ""; } catch (e) {}
			if (!cs) return;
			checked += 1;
			if (cs === sandbox.chatServerFor(sl)) agree += 1;
			else console.error("chat server mismatch", sl, cs, sandbox.chatServerFor(sl));
		});
		assert(checked > 0 && agree === checked, "chat server pick matches the API (" + agree + "/" + checked + ")");
	}

	try {
		const searched = sandbox.source.search("radio");
		assert(searched.results.length > 0, "live search returned channels");
	} catch (err) {
		fail("live search", String(err.message || err));
	}

	let details;
	try {
		details = sandbox.source.getContentDetails("https://vaughn.live/totally_70s");
	} catch (err) {
		fail("live content details", err.message);
	}
	if (details) {
		assert(details.isLive === true, "totally_70s is live");
		assert(details.viewCount >= 0, "viewer count present", details.viewCount);
		assert(!!details.live, "live source is always set (chat needs it)");
		const liveIsHls = details.live && String(details.live.url).indexOf(".m3u8") > 0;
		const alt = details.video && details.video.sources[0];
		if (!liveIsHls) {
			assert(details.live && /\.flv$/.test(details.live.url), "flv plays when no playlist is ready", details.live && details.live.url);
			assert(alt && /\.m3u8$/.test(alt.url), "hls offered as the alternate", alt && alt.url);
		}
		const flvPath = path.join("/tmp", "vaughn-live-flv.bin");
		try { fs.unlinkSync(flvPath); } catch (e) {}
		// Live FLV never ends, so curl stops on its time limit.
		try { execFileSync("curl", ["-sS", "--max-time", "4", "-A", "Mozilla/5.0", "-H", "Referer: https://vaughn.live/", "-o", flvPath, "https://stream-cdn-iad3.vaughnsoft.net/play/live_totally_70s.flv"], { stdio: "ignore" }); } catch (e) {}
		const flvHead = fs.existsSync(flvPath) ? fs.readFileSync(flvPath).slice(0, 3).toString("latin1") : "";
		assert(flvHead === "FLV", "flv stream starts with an FLV header", flvHead);
	}
	if (details && details.live && String(details.live.url).indexOf(".m3u8") > 0) {
		assert(details.video && details.video.sources.length === 1 && /\.flv$/.test(details.video.sources[0].url), "flv offered as the alternate when hls works");
		const playlist = curlGet(details.live.url, { Referer: "https://vaughn.live/" });
		assert(playlist.isOk && playlist.body.indexOf("#EXTM3U") >= 0, "playlist downloads", playlist.code);
		const segment = (playlist.body.match(/^https?:\/\/\S+\.ts$/m) || [])[0];
		assert(!!segment, "playlist lists a segment", playlist.body.slice(0, 180));
		if (segment) {
			const segPath = path.join("/tmp", "vaughn-live-segment.ts");
			execFileSync("curl", ["-sS", "-L", "--max-time", "25", "-r", "0-15", "-o", segPath, segment], { stdio: "ignore" });
			const bytes = fs.readFileSync(segPath);
			assert(bytes && bytes[0] === 0x47, "segment starts with MPEG-TS sync", bytes && bytes.slice(0, 4).toString("hex"));
		}
		const channel = sandbox.source.getChannel("https://vaughn.live/totally_70s");
		assert(channel && channel.subscribers > 0 && channel.url.indexOf("totally_70s") > 0, "channel followers", channel && channel.subscribers);
	}

	const mark = sandbox.source.getChannel("https://vaughn.live/mark");
	const markOffline = mark && String(mark.description || "").indexOf("Off air.") >= 0;
	if (!markOffline) {
		pass("mark is on air right now; offline playback was not exercised");
	} else {
		let offlineThrew = false;
		try {
			sandbox.source.getContentDetails("https://vaughn.live/mark");
		} catch (err) {
			offlineThrew = err instanceof UnavailableException || /off air|unavailable|not live/i.test(String(err.message || err));
			if (!offlineThrew) fail("offline playback error type", err.message);
		}
		assert(offlineThrew, "offline channel refuses playback");
	}

	let missingThrew = false;
	try {
		sandbox.source.getChannel("https://vaughn.live/not_a_real_channel_zz");
	} catch (err) {
		missingThrew = /not found/i.test(String(err.message || err));
	}
	assert(missingThrew, "unknown slug is not a channel");

	const events = sandbox.source.getLiveEvents("https://vaughn.live/totally_70s");
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			try { events.hasMore = false; } catch (e) {}
			const early = events.nextPage();
			const comments = (early.results || []).filter((item) => item.eventType === "comment");
			if (comments.length > 0) pass("live chat (" + comments.length + " lines, after timeout path)");
			else fail("live chat produced no comments", JSON.stringify((early.results || []).slice(0, 2)));
			resolve();
		}, 12000);
		const poll = setInterval(() => {
			const snap = events.events || [];
			const comments = snap.filter((item) => item.eventType === "comment");
			if (comments.length >= 1) {
				clearTimeout(timer);
				clearInterval(poll);
				const page = events.nextPage();
				const shown = page.results.filter((item) => item.eventType === "comment");
				assert(shown.length >= 1 && shown[0].name && shown[0].message, "live chat comment", shown[0] && (shown[0].name + ": " + shown[0].message));
				try { if (events.socket) events.socket.close(); } catch (e) {}
				resolve();
			}
		}, 250);
	});
}

(async function main() {
	try {
		unitTests();
	} catch (err) {
		fail("unit tests threw", err && err.stack || err);
	}
	try {
		await liveTests();
	} catch (err) {
		fail("live tests threw", err && err.stack || err);
	}
	if (failed) {
		console.error(failed + " failed");
		process.exit(1);
	}
	console.log("all checks passed");
})();
