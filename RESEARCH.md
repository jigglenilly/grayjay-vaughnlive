# Vaughn Live protocol notes

Checked on 2026-10-25 against the live site, the public developer API, the site's own JavaScript, and a Wayback copy of the homepage. This file is what `VaughnLiveScript.js` is built from.

Grayjay analogues used for structure: the official Kick and Twitch sources (config JSON + one `script.js`, `Http` package, `live: HLSSource` for streams, `getLiveEvents` over `http.socket`, `getLiveChatWindow` as a webview). Grayjay's client (`IPlatformClient`) exposes `getUserSubscriptions`, `getLiveEvents`, and `getLiveChatWindow`. It does not expose follow, unfollow, or send-chat methods.

## What this environment could reach

| Target | Result |
| --- | --- |
| `https://api.vaughnsoft.net/v1/stream/vl/{slug}` | HTTP 200 JSON |
| `https://api.vaughnsoft.net/v1/sapi_servers` | HTTP 200 JSON array of websocket hosts |
| `https://clutch.vaughnsoft.net/vl/{slug}.m3u8` and quality suffixes | HTTP 200 media playlists for live channels |
| `https://gateway33.vaughnsoft.net/vl/{slug}*.m3u8` | HTTP 200 on the same channels the same day (an earlier probe of the unsuffixed gateway URL returned HTTP 444, so the plugin still tries clutch first) |
| `https://s3.vaughnsoft.net/live/live_{slug}-N.ts` | HTTP 200 `video/MP2T`, first byte `0x47` |
| `wss://chat-ws-1x02.vaughnsoft.net/mvn` | Guest auth, join, and chat history |
| `wss://sapi-ws-1x01.vaughnsoft.net/mvn` | `LOAD3` / `STREAM3` |
| `https://vaughn.live/` HTML, `/app/search.php`, `/app/content_menu.php`, `/app/follow.php`, `/signin` | Cloudflare HTTP 403 from this datacenter, including with a Chrome user agent |
| `https://vaughn.live/{cache-buster}/js/vsm_65.js`, `chatv9_epsilon.js`, `vsm_65_footer.js` | HTTP 200. The site serves current bundles under a numeric path prefix |
| Wayback `https://vaughn.live/` snapshot `20261002133425` | Homepage card HTML |
| `https://breakers.tv/` | Same VaughnSoft stack, not Cloudflare-blocked here. Used only to confirm logged-out follow and following responses. Search on Breakers is HTTP 404, so it is not a stand-in for Vaughn search |

Breakers.TV is out of scope for the plugin. Its stream prefix is `#btv-` and its HLS path is `/btv/`, not `/vl/`.

## Channel and content URLs

A channel page is the stream page:

```text
https://vaughn.live/{slug}
```

Slugs are letters, digits, `_`, and `-`. The plugin treats that URL as both a channel and a content-details URL, which is the same pattern Kick uses. Extra path segments are rejected. Reserved site paths (`browse`, `signin`, `shop`, `app`, and the rest listed in the script) are not channels.

The public stream API returns HTTP 200 and a template object for unknown slugs (`live: false`, empty counters). A slug is treated as a real channel only when `live` is true or `pageviews`, `followers`, or `lastlive` is non-empty.

## Public stream API

Documented at <https://developer.vaughnsoft.com/> and rechecked live.

```text
GET https://api.vaughnsoft.net/v1/stream/vl/{slug}
GET https://api.vaughnsoft.net/v1/sapi_servers
GET https://api.vaughnsoft.net/v1/ingest_servers
```

`ingest_servers` is RTMP ingest for broadcasters. Playback does not use it.

Example fields (live `totally_70s`, 2026-10-25): `status` 200, `chat_server` `chat-ws-1x02.vaughnsoft.net`, `chat_server_irc`, `live` true, `viewers` `"9"`, `pageviews`, `followers`, `webrtc` false, `lastlive` and `lastoffair` as unix seconds, `is_mature`, `status_msg`, `about_msg`, `url`, `profile_img`.

`status_msg` and `about_msg` are base64. After decoding, the site stores some characters as decimal codes wrapped in spaces, for example ` #045 ` is `-` and ` #047 ` is `/`. `miamibeats` decoded to a title containing `Non-Stop` and `24/7`. Tags such as `[center]` and `<br>` are stripped for the Grayjay description. `about_msg` is sometimes missing padding; the decoder adds it.

`profile_img` is the avatar when present. Otherwise `https://cdn.vaughnsoft.net/profile/0/{slug}.jpg`.

Live thumbnails follow the player convention:

```text
https://thumbnails.vaughnsoft.net/{utcHour}_{0|15|30|45}/fetch/live/{slug}.webp
```

The minute bucket is 0, 15, 30, or 45.

## HLS playback

The developer docs do not publish the playlist URL. The player requests:

```text
https://clutch.vaughnsoft.net/vl/{slug}.m3u8
https://clutch.vaughnsoft.net/vl/{slug}-high.m3u8
https://clutch.vaughnsoft.net/vl/{slug}-medium.m3u8
https://clutch.vaughnsoft.net/vl/{slug}-low.m3u8
https://clutch.vaughnsoft.net/vl/{slug}-audio.m3u8
```

`gateway33.vaughnsoft.net` serves the same paths. The older `https://clutch.vaughnsoft.net/ord/vl/{slug}.m3u8` path is HTTP 404. Referer was not required for these GETs. The plugin still sends `Referer: https://vaughn.live/` and `Origin: https://vaughn.live`.

A live playlist is a media playlist, not a master:

```text
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXTINF:4.209, no desc
https://s3.vaughnsoft.net/live/live_totally_70s-0.ts
```

Quality suffixes often point at the same segments when the channel is not transcoded. The plugin probes clutch, then gateway, and the suffixes `""`, `-high`, `-medium`, `-low`, and exposes the first body that contains `#EXTM3U` as one HLS source named `Live`. That avoids handing Grayjay a URL that sometimes answers HTTP 444.

`webrtc: true` on the REST object means the channel expects a WebRTC player. If no playlist responds, playback fails with that reason.

Verified 2026-10-25: playlists and a MPEG-TS segment for `totally_70s` (`video/MP2T`, sync byte `0x47`). The same playlist hosts also returned `#EXTM3U` for `bobbymagicradio2` and `tech_corner`.

## sApi websocket

Documented at <https://developer.vaughnsoft.com/>. Rechecked live against `totally_70s`.

```text
wss://sapi-ws-1x01.vaughnsoft.net/mvn
MVN LOAD3 #vl-{slug} guest guest\n\0
MVN STREAM3 #vl-{slug}\n\0
PING -> PONG
```

`STREAM3` fields, from the docs: `[0]` channel, `[1]` deprecated client count, `[2]` viewers, `[6]` live flag, `[7]` HLS supported, `[10]` status (`0` off air, `1` live, `2` banned).

Live sample:

```text
STREAM3 #vl-totally_70s;3;9;-1;-1;0;1;0;0;-1;1;
```

Viewer count `9` matched the REST `viewers` field, `[6]` was `1`, and `[10]` was `1`. `[7]` was `0` while clutch HLS for that channel returned HTTP 200. The plugin does not use `[7]` as a gate.

Playback does not need sApi. REST plus a playlist probe is enough, and it does not depend on a second socket staying open.

## Home

The homepage is server-rendered HTML. Current cards use `id="vs_v9_frontpage_streams_box..."`, a link to `https://vaughn.live/{slug}` or `/{slug}`, an image, `vs_v9_frontpage_streams_duration` (`11 Viewers`), and two `vs_v9_frontpage_streams_box_profile_title` nodes (channel name, then stream title).

The Wayback snapshot `20261002133425` of <https://vaughn.live/> has that markup. Two cards from it are in `test/fixtures/home-cards.html`. An older `/browse/all` snapshot uses `browsePageStreamBox` instead. The plugin only parses the current frontpage markup and does not paginate browse.

`getHome` fetches `https://vaughn.live/`. The site also pins `vaughn.live/events`, which is an announcements page rather than a viewer channel, so that slug is ignored. Card titles are HTML, including numeric entities such as `&#128226;`. A normal 200 response still includes Cloudflare's `/cdn-cgi/challenge-platform/scripts/jsd/main.js` bot script; that path is not a block. The plugin treats the response as a challenge when the status is 403 or 503, or when the document is an interstitial: title `Just a moment`, body `Attention Required`, or `cf-chl` on a page that is not the frontpage. A fresh HTTP client often gets 403 on the first `vaughn.live` request and 200 on the next, so a failed 403/503 is retried once after a favicon request. This datacenter still receives a real 403 page.

## Search

From the live `vsm_65.js` (about 1.8 MB, fetched 2026-10-25):

```text
GET /app/search.php?q={query}
body = JSON.parse(atob(response))[0].streams
each item: { name, live }
```

The query is limited to letters, digits, space, `_`, and `-`, matching the site's input. Suggestions are the channel names from that same call.

The response body was not captured. `vaughn.live` returns a Cloudflare challenge for that PHP path from here, and `breakers.tv/app/search.php` is HTTP 404. Search is implemented from the client code and covered by a fixture in the harness. It has not been confirmed against a real Vaughn response.

Each hit is then enriched with the public stream API so titles, viewers, and live state come from a verified source. Offline hits stay in search results. Opening one calls `getContentDetails`, which refuses playback when `live` is false.

## Chat

Current player: `chatv9_epsilon.js`. Connect:

```text
wss://{chat_server}/mvn
MVN AUTH {user} {token} #vl-{slug}\0
```

`chat_server` comes from the stream API (`chat-ws-1x02.vaughnsoft.net` for `totally_70s`). On `ACK ...` the player sends `JOIN #vl-{slug}`. `PING` is answered with `PONG`.

The public developer example sends `MVN AUTH guest guest` with no channel and no trailing NUL, then `JOIN`. The current player includes the channel and a NUL. A guest session using the player format succeeded.

Verified history line (guest, `totally_70s`):

```text
kirbykrazy2;Blue;2;1;vl;0;1;0;0;{base64};{uuid};{uuid} HISTORY 2026-10-25T03:00:01.703Z #vl-totally_70s :Next week will be Pascal\0
```

The same framing is used for `CHAT` and `HISTORY2`. The username is the first semicolon field. The message is everything after ` :`. The site HTML-escapes apostrophes (`&#039;`). The plugin decodes those entities.

`JOIN`, `PART`, `ACK`, `MVN HISTORYEND`, and `MVN FOLLOW` are not rendered as comments. `MVN FOLLOW {username}` is the follower alert documented by VaughnSoft. It is not mapped to a Grayjay event type.

Logged-in chat does not read `vsk1`, `vsk2`, or `vsk3`. In `chatv9_epsilon.js`, `connect()` sets the auth user to `window.vs_username` and the auth token to `window.vs_token` (the comma expression assigns the token to the socket password), then sends `MVN AUTH {username} {token} #vl-{slug}`. The server prints those two globals into the channel HTML. Guest pages use `guest` / `guest` (a logged-out homepage snapshot used `-4` and an empty token). The current JavaScript never mentions `vsk1`, `vsk2`, or `vsk3`, and no request in the bundle returns the chat token from a cookie value. The plugin loads the channel page with the auth HTTP client, which sends the stored session cookies, and reads the globals. Guest read worked. A logged-in socket was not opened from here.

Sending a message, from the player, is:

```text
CHAT #vl-{slug},{uuid} :{message}\n
```

Grayjay has no plugin method for sending live chat. The script does not invent one. `getLiveChatWindow` returns the site's pop-out chat page, `https://vaughn.live/{slug}/chat`, which is chat-only (the same approach the Twitch and Kick plugins take).

## Login

The header control `.vs_v9_header_menu_item4 .vs_v9_header_button` calls `Modal.SignIn2()` (tooltip "Log In Now"). `#vs_v9_header_golive` calls the same modal when logged out. The plugin's `loginButton` is the Log In control. Grayjay only allows a CSS selector of `[a-zA-Z-.#:_ ]` in that field, so the class selector is the one that fits.

`Modal.SignIn2()` loads `/signin2`. The form posts through `vs_core.Login()`:

```text
POST /signin?a=process&b={timestamp}
u={username}&p={password}
```

The form fields are named `u2` and `p2`. The POST body uses `u` and `p`. A hidden rotating `theKey_{unix}` field is not part of that POST.

Response codes in `vsm_65.js`: `1` success and the page reloads the same URL (`window.location = document.location`); `0` invalid; `3` rate limit; `5` VPN wall; `6` must use username; `7` blank password; `8` password too short. There is no captcha on this post. A newer login modal in the same file accepts a Turnstile token and then only logs it; it does not post credentials. A bad-user POST to Breakers (same code path) returned body `2` and no `Set-Cookie`. Vaughn's `/signin` from this network is Cloudflare 403, so the success `Set-Cookie` headers were not observed here.

A residential logout/login check (2026-10-25) found:

| Cookie | When it exists |
| --- | --- |
| `vsk0` | Present for a visitor and still present after logout. Not a session cookie |
| `vsk6` | HttpOnly visitor cookie seen before login, unchanged by login |
| `vsk1`, `vsk2`, `vsk3` | Absent after logout, present only after a successful sign-in |

The live `vsm_65.js` fetched the same day writes `vsk0` and nothing else in that family:

```text
document.cookie = `vsk0=${visitorId}; max-age=315360000; path=/; SameSite=Lax`
```

`visitorId` comes from `main_v9.js` (FingerprintJS). `max-age=315360000` is 10 years. The script then POSTs that id to `/`. `vsk1`, `vsk2`, and `vsk3` do not appear anywhere in the current homepage, chat, footer, or fingerprint bundles, so the client never shows what they contain. They are set by the `/signin` response. Grayjay's `cookiesToFind` is all three, because login only finishes when every listed name is in the jar. `completionUrl` is `https://vaughn.live/`, the same page the success reload stays on. `cookiesExclOthers` is false, so `vsk0` and the other cookies collected in the webview are kept.

`_se` is only assigned by `header_html5.js`, an older player that the current homepage does not load, with an expiry in 2023. It is not the session.

An account with an unconfirmed email still gets the session cookies. The site's confirm-email UI posts to `/app/confirm_email.php` and tells the user to confirm before some chat rooms; that banner is not a second login step.

Logged-out checks on Breakers, which speaks the same PHP:

```text
GET /app/content_menu.php?a=following  -> -1
POST /app/follow.php  a=1&chan={slug}  -> 2
```

`2` means "needs sign-in". `1` means the follow or unfollow succeeded (`a=1` follow, `a=2` unfollow), from `vs_channel_v9` in `vsm_65_footer.js`.

## Subscriptions

There is no Grayjay hook for follow or unfollow. The follow HTTP call above cannot be bound to a subscribe button.

`getUserSubscriptions` calls `GET /app/content_menu.php?a=following` with the auth client. Logged out, the body is `-1` (confirmed on Breakers) and the plugin returns an empty list. Logged in, `RenderContentMenuFollowing` does `atob(body).split(";")`. Each record is comma-separated `key=value` fields. Index 1 is `stream_name={slug}`. The plugin returns `https://vaughn.live/{slug}` for each name. The menu UI only renders six rows; the plugin returns every parsed name.

A logged-in Vaughn body was not captured. The parser is tested against a fixture shaped like that client code. A Cloudflare challenge returns an empty list instead of failing the subscriptions screen.

## Grayjay method map

| Plugin method | Source |
| --- | --- |
| `getHome` | Homepage HTML cards |
| `search` / `searchSuggestions` / `searchChannels` | `/app/search.php`, then the stream API |
| `getChannel` / `getChannelContents` | Stream API. Contents is the live stream, or empty when off air |
| `getContentDetails` | Stream API + first working HLS playlist, `live` set, `video` empty |
| `getLiveEvents` | Chat websocket. Comments and one viewer-count event |
| `getLiveChatWindow` | Pop-out chat page `/{slug}/chat` |
| `getUserSubscriptions` | `/app/content_menu.php?a=following` |
| `getComments` | Empty. Chat is live events, not comments |

Offline channels throw `UnavailableException` when Grayjay provides it, otherwise `ScriptException`. Unknown slugs throw "Channel not found".
