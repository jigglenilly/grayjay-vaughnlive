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
