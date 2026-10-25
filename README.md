# Vaughn Live for Grayjay

A [Grayjay](https://grayjay.app/) source for [vaughn.live](https://vaughn.live/).

## Install

In Grayjay, go to **Sources → Add source → Install by URL** and paste:

```
https://raw.githubusercontent.com/jigglenilly/grayjay-vaughnlive/main/VaughnLiveConfig.json
```

## Features

- Home feed of live channels
- Search channels
- Channel pages
- Live playback (HLS)
- Live chat
- Login through Grayjay's built-in sign-in
- Import followed channels

Not supported by Grayjay's plugin API: following/unfollowing from the app and sending chat from the plugin.

## Development

`node test/harness.js` runs the tests (Node 22+, or Node 20 with `--experimental-websocket`). Protocol notes are in [RESEARCH.md](RESEARCH.md).

## Credits

Written by Grok Bot.

Sources:
- [Grayjay plugin docs](https://gitlab.futo.org/videostreaming/grayjay/-/tree/master/docs)
- [Official Grayjay plugins](https://gitlab.futo.org/videostreaming/plugins), mainly Twitch and Kick, used as structural references
- vaughn.live's public pages, scripts, and stream API
