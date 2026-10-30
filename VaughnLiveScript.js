/**
 * Grayjay source for https://vaughn.live
 *
 * Playback, channel metadata, and chat were checked against the live site.
 * See RESEARCH.md for the protocol and what is still unconfirmed.
 */

const PLATFORM = "Vaughn Live";
const BASE_URL = "https://vaughn.live/";
const API_STREAM = "https://api.vaughnsoft.net/v1/stream/vl/";
// vaughn.live's own player uses gateway33 for HLS. Clutch often answers 444 or stalls.
const HLS_HOSTS = [
	"https://gateway33.vaughnsoft.net",
	"https://clutch.vaughnsoft.net",
];
// The site's default web player now plays HTTP-FLV from this host.
const FLV_BASE = "https://stream-cdn-iad3.vaughnsoft.net/play/live_";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const RESERVED_SLUGS = {
	browse: true,
	signin: true,
	signin2: true,
	signup: true,
	signup2: true,
	shop: true,
	terms: true,
	privacy: true,
	cookies: true,
	copyright: true,
	howto: true,
	settings: true,
	overlay: true,
	help: true,
	vip: true,
	search: true,
	login: true,
	logout: true,
	app: true,
	api: true,
	developers: true,
	blog: true,
	img: true,
	css: true,
	js: true,
	cdn: true,
	favicon: true,
	robots: true,
	sitemap: true,
	account: true,
	about: true,
	contact: true,
	support: true,
	manifest: true,
	embed: true,
	popout: true,
	chat: true,
	player: true,
	watch: true,
	directory: true,
	events: true,
	categories: true,
	following: true,
	followers: true,
};

let config = {};

source.enable = function (conf) {
	config = conf || {};
};

source.disable = function () {};

source.getHome = function () {
	return new FrontpagePager(BASE_URL);
};

source.searchSuggestions = function (query) {
	const q = sanitizeQuery(query);
	if (!q) return [];
	try {
		return searchStreams(q).slice(0, 8).map(function (item) {
			return item.name;
		});
	} catch (e) {
		return [];
	}
};

source.getSearchCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [],
		filters: [],
	};
};

source.search = function (query) {
	const items = searchStreams(sanitizeQuery(query));
	const videos = [];
	for (let i = 0; i < items.length && i < 24; i++) {
		const info = fetchStream(items[i].name);
		if (!info || !info.exists) continue;
		videos.push(streamToVideo(info, items[i].live));
	}
	return new VideoPager(videos, false, {});
};

source.searchChannels = function (query) {
	const items = searchStreams(sanitizeQuery(query));
	const channels = [];
	for (let i = 0; i < items.length && i < 24; i++) {
		const info = fetchStream(items[i].name);
		if (!info || !info.exists) continue;
		channels.push(streamToChannel(info));
	}
	return new ChannelPager(channels, false, {});
};

source.isChannelUrl = function (url) {
	return !!slugFromUrl(url);
};

source.getChannel = function (url) {
	const slug = slugFromUrl(url);
	if (!slug) throw new ScriptException("Not a Vaughn Live channel URL");
	const info = fetchStream(slug);
	if (!info || !info.exists) throw new ScriptException("Channel not found: " + slug);
	return streamToChannel(info);
};

source.getChannelContents = function (url) {
	const slug = slugFromUrl(url);
	if (!slug) return new VideoPager([], false, {});
	const info = fetchStream(slug);
	if (!info || !info.exists || !info.live) return new VideoPager([], false, {});
	return new VideoPager([streamToVideo(info, true)], false, {});
};

source.isContentDetailsUrl = function (url) {
	return !!slugFromUrl(url);
};

source.getContentDetails = function (url) {
	const slug = slugFromUrl(url);
	if (!slug) throw new ScriptException("Not a Vaughn Live stream URL");
	const info = fetchStream(slug);
	if (!info || !info.exists) throw new ScriptException("Channel not found: " + slug);
	if (!info.live) throw offlineError((info.label || slug) + " is off air");

	// HLS when a playlist answers, otherwise the HTTP-FLV stream the site itself plays.
	const playlist = firstWorkingPlaylist(slug);
	const hls = playlist ? makeHls(playlist) : null;
	const sources = playlist ? [] : [makeFlv(slug)];
	const details = new PlatformVideoDetails({
		id: new PlatformID(PLATFORM, slug, config.id),
		name: info.title || info.label || slug,
		thumbnails: new Thumbnails([new Thumbnail(thumbnailUrl(slug), 480)]),
		author: authorLink(info),
		uploadDate: info.lastLive || unixNow(),
		duration: 0,
		viewCount: info.viewers,
		url: channelUrl(slug),
		isLive: true,
		description: channelDescription(info),
		video: new VideoSourceDescriptor(sources),
		live: hls,
	});

	details.getContentRecommendations = function () {
		return recommendOtherLives(url);
	};
	return details;
};

source.getContentRecommendations = function (url) {
	return recommendOtherLives(url);
};

source.getComments = function () {
	return new CommentPager([], false, {});
};

source.getSubComments = function () {
	return new CommentPager([], false, {});
};

source.getLiveChatWindow = function (url) {
	const slug = slugFromUrl(url);
	if (!slug) return null;
	// Pop-out chat page, like the Twitch and Kick plugins use.
	return { url: channelUrl(slug) + "/chat" };
};

source.getLiveEvents = function (url) {
	const slug = slugFromUrl(url);
	if (!slug) return new LiveEventPager([], false, {});
	const info = fetchStream(slug);
	if (!info || !info.exists) return new LiveEventPager([], false, {});
	return new VaughnLiveEventPager(slug, info);
};

source.getUserSubscriptions = function () {
	let body = "";
	try {
		body = httpGet(BASE_URL + "app/content_menu.php?a=following", pageHeaders(), true);
	} catch (e) {
		return [];
	}
	const trimmed = String(body || "").trim();
	if (!trimmed || trimmed === "-1") return [];
	const decoded = b64decode(trimmed);
	if (!decoded || decoded === "-1") return [];
	const urls = [];
	const seen = {};
	const records = decoded.split(";");
	for (let i = 0; i < records.length; i++) {
		const fields = parseMenuFields(records[i]);
		const name = fields.stream_name;
		if (!name || seen[name] || RESERVED_SLUGS[name.toLowerCase()]) continue;
		seen[name] = true;
		urls.push(channelUrl(name));
	}
	return urls;
};

class FrontpagePager extends VideoPager {
	constructor(url) {
		const videos = loadFrontpage(url);
		super(videos, false, { url: url });
	}

	nextPage() {
		this.results = [];
		this.hasMore = false;
		return this;
	}
}

class VaughnLiveEventPager extends LiveEventPager {
	constructor(slug, info) {
		super([], true, {});
		this.nextRequest = 3000;
		this.slug = slug;
		this.events = [];
		this.viewers = info.viewers || 0;
		this._joined = false;
		const me = this;
		const server = info.chatServer || "chat-ws-1x02.vaughnsoft.net";
		const creds = readChatCredentials(slug);
		let socket = null;
		try {
			socket = http.socket("wss://" + server + "/mvn", {}, false);
		} catch (e) {
			this.hasMore = false;
			return;
		}
		this.socket = socket;
		socket.connect({
			open: function () {
				socket.send("MVN AUTH " + creds.user + " " + creds.token + " #vl-" + slug + "\0");
			},
			message: function (msg) {
				// Grayjay can wait longer than a few seconds between nextPage calls.
				// Closing on that gap drops the socket while the stream is still open.
				const lines = String(msg || "").split("\n");
				for (let i = 0; i < lines.length; i++) {
					handleChatLine(me, lines[i], socket, slug);
				}
			},
			close: function () {
				me.hasMore = false;
			},
			error: function () {
				me.hasMore = false;
			},
		});
		if (this.viewers > 0) this.events.push(new LiveEventViewCount(this.viewers));
	}

	nextPage() {
		this.results = this.events;
		this.events = [];
		return this;
	}
}

function handleChatLine(pager, rawLine, socket, slug) {
	let raw = String(rawLine || "").replace(/\0/g, "").trim();
	if (!raw) return;
	if (raw === "PING") {
		try { socket.send("PONG"); } catch (e) {}
		return;
	}
	if (raw.indexOf("ACK ") === 0 && !pager._joined) {
		pager._joined = true;
		try { socket.send("JOIN #vl-" + slug); } catch (e) {}
		return;
	}
	const parsed = parseChatMessage(raw);
	if (!parsed || !parsed.message) return;
	// The site bot posts join/leave lines as ordinary HISTORY rows. Grayjay has no system-message event.
	if (isJoinLeaveNotice(parsed.user, parsed.message)) return;
	pager.events.push(new LiveEventComment(parsed.user, parsed.message, ""));
}

function isJoinLeaveNotice(user, message) {
	if (String(user || "").toLowerCase() !== "vaughn") return false;
	return /^->\s+(?:\[[^\]]*\]\s+)?@?[A-Za-z0-9_-]+\s+(?:entered|left)\b/.test(String(message || ""));
}

function parseChatMessage(raw) {
	const space = raw.indexOf(" ");
	if (space < 0) return null;
	const head = raw.slice(0, space);
	const rest = raw.slice(space + 1);
	const kind = rest.split(" ")[0];
	if (kind !== "CHAT" && kind !== "HISTORY" && kind !== "HISTORY2") return null;
	const user = head.split(";")[0] || "guest";
	const mark = raw.indexOf(" :");
	if (mark < 0) return null;
	const message = decodeEntities(raw.slice(mark + 2)).trim();
	if (!message) return null;
	return { user: user, message: message };
}

function readChatCredentials(slug) {
	// The chat socket uses window.vs_username and window.vs_token from the channel HTML.
	// vsk1/vsk2/vsk3 are not read by the site script; the server prints those globals when the session is present.
	try {
		const html = httpGet(channelUrl(slug), pageHeaders(), true);
		const user = matchAssign(html, "vs_username");
		const token = matchAssign(html, "vs_token");
		if (user && token && user !== "guest" && user !== "-4" && token !== "guest") {
			return { user: user, token: token };
		}
	} catch (e) {}
	return { user: "guest", token: "guest" };
}

function matchAssign(html, name) {
	const re = new RegExp("(?:window\\.)?" + name + "\\s*=\\s*\"([^\"]*)\"");
	const m = re.exec(html || "");
	return m ? m[1] : "";
}

function recommendOtherLives(url) {
	let videos = [];
	try {
		videos = loadFrontpage(BASE_URL);
	} catch (e) {
		return new VideoPager([], false, {});
	}
	const current = channelUrl(slugFromUrl(url) || "");
	const filtered = [];
	for (let i = 0; i < videos.length; i++) {
		if (videos[i].url !== current) filtered.push(videos[i]);
		if (filtered.length >= 24) break;
	}
	return new VideoPager(filtered, false, {});
}

function loadFrontpage(url) {
	const html = httpGet(url, pageHeaders(), false);
	const videos = extractFrontpageStreams(html);
	if (!videos.length && html.indexOf("vs_v9_frontpage") < 0) {
		throw new ScriptException("Could not read the Vaughn Live home page.");
	}
	return videos;
}

function extractFrontpageStreams(html) {
	const chunks = String(html || "").split('id="vs_v9_frontpage_streams_box');
	const videos = [];
	const seen = {};
	for (let i = 1; i < chunks.length; i++) {
		const slice = chunks[i].slice(0, 4000);
		const slug = slugFromChunk(slice);
		if (!slug || seen[slug]) continue;
		seen[slug] = true;
		const titles = [];
		const titleRe = /frontpage_streams_box_profile_title">\s*([^<]+)/g;
		let m;
		while ((m = titleRe.exec(slice))) titles.push(decodeEntities(m[1]).trim());
		const name = titles[0] || slug;
		const title = titles[1] || name;
		const viewersMatch = /frontpage_streams_duration">\s*([^<]+)/.exec(slice);
		const viewers = viewersMatch ? parseInt(viewersMatch[1], 10) || 0 : 0;
		const imgMatch = /src="([^"]+)"/.exec(slice);
		const thumb = imgMatch ? absolutize(imgMatch[1]) : thumbnailUrl(slug);
		videos.push(new PlatformVideo({
			id: new PlatformID(PLATFORM, slug, config.id),
			name: title,
			thumbnails: new Thumbnails([new Thumbnail(thumb, 480)]),
			author: new PlatformAuthorLink(
				new PlatformID(PLATFORM, slug, config.id),
				name,
				channelUrl(slug),
				profileUrl(slug)
			),
			uploadDate: unixNow(),
			duration: 0,
			viewCount: viewers,
			url: channelUrl(slug),
			isLive: true,
		}));
	}
	return videos;
}

function searchStreams(query) {
	if (!query) return [];
	const body = httpGet(BASE_URL + "app/search.php?q=" + encodeURIComponent(query), pageHeaders(), false);
	let decoded = body;
	if (body && body.charAt(0) !== "[" && body.charAt(0) !== "{") decoded = b64decode(body.trim());
	let json;
	try {
		json = JSON.parse(decoded);
	} catch (e) {
		throw new ScriptException("Could not read Vaughn Live search results.");
	}
	const block = Array.isArray(json) ? json[0] : json;
	const streams = (block && block.streams) || [];
	const out = [];
	const seen = {};
	for (let i = 0; i < streams.length; i++) {
		const name = String(streams[i].name || "").trim();
		if (!name || seen[name] || RESERVED_SLUGS[name.toLowerCase()]) continue;
		seen[name] = true;
		out.push({ name: name, live: !!streams[i].live });
	}
	return out;
}

function fetchStream(slug) {
	let body;
	try {
		body = httpGet(API_STREAM + encodeURIComponent(slug), {
			"User-Agent": USER_AGENT,
			Accept: "application/json",
			Referer: BASE_URL,
		}, false);
	} catch (e) {
		return null;
	}
	let data;
	try {
		data = JSON.parse(body);
	} catch (e) {
		return null;
	}
	if (!data || data.status !== 200) return null;
	const pageviews = String(data.pageviews || "");
	const followers = String(data.followers || "");
	const lastLive = parseInt(data.lastlive, 10) || 0;
	const exists = data.live === true || pageviews !== "" || followers !== "" || lastLive > 0;
	const label = slug;
	const title = decodeVaughnText(data.status_msg) || label;
	return {
		slug: slug,
		exists: exists,
		live: data.live === true,
		viewers: parseInt(data.viewers, 10) || 0,
		followers: parseInt(followers, 10) || 0,
		pageviews: parseInt(pageviews, 10) || 0,
		lastLive: lastLive,
		title: title,
		about: decodeVaughnText(data.about_msg),
		mature: !!data.is_mature,
		webrtc: !!data.webrtc,
		profile: data.profile_img || profileUrl(slug),
		chatServer: data.chat_server || "",
		label: label,
	};
}

function firstWorkingPlaylist(slug) {
	const urls = HLS_HOSTS.map((host) => host + "/vl/" + slug + ".m3u8");
	let responses = null;
	// Probe the hosts at once. A stalled host can take 15+ seconds.
	try {
		if (typeof http.batch === "function") {
			let batch = http.batch();
			urls.forEach((url) => { batch = batch.GET(url, mediaHeaders(), false); });
			responses = batch.execute();
		}
	} catch (e) {
		responses = null;
	}
	if (!responses || responses.length !== urls.length) {
		responses = urls.map((url) => {
			try { return http.GET(url, mediaHeaders(), false); } catch (e) { return null; }
		});
	}
	for (let i = 0; i < urls.length; i++) {
		const resp = responses[i];
		if (resp && resp.isOk !== false && String(resp.body || "").indexOf("#EXTM3U") >= 0) return urls[i];
	}
	return "";
}

function makeFlv(slug) {
	return new VideoUrlSource({
		name: "Live (FLV)",
		width: 0,
		height: 0,
		container: "video/x-flv",
		codec: "",
		bitrate: 0,
		duration: 0,
		url: FLV_BASE + slug + ".flv",
		requestModifier: {
			headers: {
				// vaughnsoft hosts stall for player-library agents such as ExoPlayer and okhttp.
				"User-Agent": USER_AGENT,
				Referer: BASE_URL,
				Origin: "https://vaughn.live",
			},
		},
	});
}

function makeHls(url) {
	return new HLSSource({
		name: "Live",
		duration: 0,
		url: url,
		priority: true,
		requestModifier: {
			headers: {
				// vaughnsoft hosts stall for player-library agents such as ExoPlayer and okhttp.
				"User-Agent": USER_AGENT,
				Referer: BASE_URL,
				Origin: "https://vaughn.live",
			},
		},
	});
}

function streamToVideo(info, live) {
	return new PlatformVideo({
		id: new PlatformID(PLATFORM, info.slug, config.id),
		name: info.title || info.slug,
		thumbnails: new Thumbnails([new Thumbnail(thumbnailUrl(info.slug), 480)]),
		author: authorLink(info),
		uploadDate: info.lastLive || unixNow(),
		duration: 0,
		viewCount: info.viewers,
		url: channelUrl(info.slug),
		isLive: live !== false && !!info.live,
	});
}

function streamToChannel(info) {
	return new PlatformChannel({
		id: new PlatformID(PLATFORM, info.slug, config.id),
		name: info.slug,
		thumbnail: info.profile || profileUrl(info.slug),
		banner: "",
		subscribers: info.followers || 0,
		description: channelDescription(info),
		url: channelUrl(info.slug),
		links: {},
	});
}

function authorLink(info) {
	return new PlatformAuthorLink(
		new PlatformID(PLATFORM, info.slug, config.id),
		info.slug,
		channelUrl(info.slug),
		info.profile || profileUrl(info.slug)
	);
}

function channelDescription(info) {
	const parts = [];
	if (info.mature) parts.push("Marked mature.");
	if (info.about) parts.push(info.about);
	if (!info.live) parts.push("Off air.");
	if (info.followers) parts.push(info.followers + " followers.");
	return parts.join("\n\n");
}

function slugFromUrl(url) {
	if (!url) return "";
	const text = String(url).trim();
	const match = /vaughn\.live\/([A-Za-z0-9_-]+)/i.exec(text);
	if (!match) return "";
	const slug = match[1];
	if (RESERVED_SLUGS[slug.toLowerCase()]) return "";
	if (/[?#].*[\\/]/.test(text.slice(text.indexOf(slug) + slug.length))) return "";
	const rest = text.slice(text.toLowerCase().indexOf(slug.toLowerCase()) + slug.length);
	if (rest.indexOf("/") >= 0 && rest.indexOf("/") < rest.search(/[?#]|$/)) {
		const after = rest.split(/[?#]/)[0];
		if (after !== "" && after !== "/") return "";
	}
	return slug;
}

function slugFromChunk(slice) {
	let m = /vaughn\.live\/([A-Za-z0-9_-]+)/i.exec(slice);
	if (m && !RESERVED_SLUGS[m[1].toLowerCase()]) return m[1];
	m = /href="\/([A-Za-z0-9_-]+)"/.exec(slice);
	if (m && !RESERVED_SLUGS[m[1].toLowerCase()]) return m[1];
	return "";
}

function channelUrl(slug) {
	return BASE_URL + slug;
}

function absolutize(url) {
	const text = String(url || "").trim();
	if (!text) return "";
	if (text.indexOf("//") === 0) return "https:" + text;
	if (text.indexOf("http://") === 0 || text.indexOf("https://") === 0) return text;
	if (text.charAt(0) === "/") return "https://vaughn.live" + text;
	return BASE_URL + text;
}

function profileUrl(slug) {
	return "https://cdn.vaughnsoft.net/profile/0/" + slug + ".jpg";
}

function thumbnailUrl(slug) {
	const now = new Date();
	const minute = now.getUTCMinutes();
	let bucket = "0";
	if (minute >= 46) bucket = "45";
	else if (minute >= 31) bucket = "30";
	else if (minute >= 16) bucket = "15";
	return "https://thumbnails.vaughnsoft.net/" + now.getUTCHours() + "_" + bucket + "/fetch/live/" + slug + ".webp";
}

function parseMenuFields(record) {
	const fields = {};
	const parts = String(record || "").split(",");
	for (let i = 0; i < parts.length; i++) {
		const eq = parts[i].indexOf("=");
		if (eq <= 0) continue;
		fields[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
	}
	return fields;
}

function pageHeaders() {
	return {
		"User-Agent": USER_AGENT,
		Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
		Referer: BASE_URL,
		"Accept-Language": "en-US,en;q=0.9",
	};
}

function mediaHeaders() {
	return {
		"User-Agent": USER_AGENT,
		Accept: "application/vnd.apple.mpegurl,*/*",
		Referer: BASE_URL,
		Origin: "https://vaughn.live",
	};
}

function httpGet(url, headers, useAuth) {
	let resp = http.GET(url, headers || {}, !!useAuth);
	// A new Grayjay Http client often gets 403 on its first vaughn.live hit and 200 on the next.
	if (shouldRetryVaughn(url, resp)) {
		try { http.GET("https://vaughn.live/favicon.ico", headers || {}, !!useAuth); } catch (e) {}
		resp = http.GET(url, headers || {}, !!useAuth);
	}
	const code = responseCode(resp);
	const body = resp && resp.body != null ? String(resp.body) : "";
	if (isVaughnSite(url) && (code === 403 || code === 503 || isChallengeBody(body))) {
		throw new ScriptException("vaughn.live returned a Cloudflare challenge instead of the page.");
	}
	if (!resp || resp.isOk === false) {
		throw new ScriptException("Request failed " + code + " " + url);
	}
	return body;
}

function responseCode(resp) {
	if (!resp) return 0;
	const raw = resp.code != null ? resp.code : resp.status;
	const code = parseInt(raw, 10);
	return isNaN(code) ? 0 : code;
}

function isVaughnSite(url) {
	return /^https:\/\/(?:www\.)?vaughn\.live(?:\/|$)/i.test(String(url || ""));
}

function shouldRetryVaughn(url, resp) {
	if (!isVaughnSite(url)) return false;
	const code = responseCode(resp);
	if (code === 403 || code === 503) return true;
	return !!(resp && resp.isOk === false && code === 0);
}

function isChallengeBody(body) {
	const text = String(body || "");
	// A normal 200 page includes /cdn-cgi/challenge-platform/scripts/jsd/main.js. That path is not a block.
	// Card text can also mention "Just a moment", so the interstitial is the title, the Attention Required
	// block page, or a cf-chl document that is not the frontpage.
	if (text.indexOf("vs_v9_frontpage") >= 0) return false;
	if (text.indexOf("Attention Required") >= 0) return true;
	if (/<title>[^<]*Just a moment/i.test(text)) return true;
	if (text.indexOf("cf-chl") >= 0 && /<!doctype html|<html|cloudflare/i.test(text)) return true;
	return false;
}

function sanitizeQuery(query) {
	return String(query || "").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
}

function decodeEntities(text) {
	let out = String(text || "");
	for (let pass = 0; pass < 2; pass++) {
		const next = out
			.replace(/&#(\d{1,7});/g, function (_, n) { return codePointChar(parseInt(n, 10)); })
			.replace(/&#x([0-9a-fA-F]{1,6});/g, function (_, n) { return codePointChar(parseInt(n, 16)); })
			.replace(/&nbsp;/gi, " ")
			.replace(/&quot;/gi, "\"")
			.replace(/&apos;/gi, "'")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&amp;/gi, "&");
		if (next === out) break;
		out = next;
	}
	return out.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function codePointChar(c) {
	if (!isFinite(c) || c <= 0 || c > 0x10FFFF) return "";
	if (c >= 0xD800 && c <= 0xDFFF) return "";
	if (typeof String.fromCodePoint === "function") return String.fromCodePoint(c);
	if (c <= 0xFFFF) return String.fromCharCode(c);
	const u = c - 0x10000;
	return String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 0x3FF));
}

function decodeVaughnText(b64) {
	let text = b64decode(b64);
	if (!text) return "";
	// Entity decode runs first so &#128226; is not eaten by the site's #NNN codes.
	text = decodeEntities(text);
	text = text.replace(/ #(\d{2,3}) /g, function (_, n) {
		return charFromCode(n);
	});
	text = text.replace(/(^|[^&])#(\d{2,3})(?!\d)/g, function (_, pre, n) {
		return pre + charFromCode(n);
	});
	text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
	return decodeEntities(text);
}

function charFromCode(n) {
	const c = parseInt(n, 10);
	if (c >= 32 && c < 127) return String.fromCharCode(c);
	return " ";
}

function b64decode(input) {
	if (!input) return "";
	let str = String(input).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
	while (str.length % 4) str += "=";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const bytes = [];
	for (let i = 0; i < str.length; i += 4) {
		const a = chars.indexOf(str.charAt(i));
		const b = chars.indexOf(str.charAt(i + 1));
		const c = chars.indexOf(str.charAt(i + 2));
		const d = chars.indexOf(str.charAt(i + 3));
		if (a < 0 || b < 0) break;
		const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
		bytes.push((n >> 16) & 255);
		if (str.charAt(i + 2) !== "=") bytes.push((n >> 8) & 255);
		if (str.charAt(i + 3) !== "=") bytes.push(n & 255);
	}
	if (typeof TextDecoder !== "undefined") {
		try { return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)); } catch (e) {}
	}
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return out;
}

function unixNow() {
	return Math.floor(Date.now() / 1000);
}

function offlineError(message) {
	if (typeof UnavailableException === "function") throw new UnavailableException(message);
	throw new ScriptException(message);
}
