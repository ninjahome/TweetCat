// // inject.ts
// // 目标：在前端完整枚举可下载“items”（与 ytdlp_host.sh 近似风格），只依赖 itag，不依赖 URL。
// // 策略：
// //   1) 优先从页面的 playerResponse 读取 formats / adaptiveFormats；
// //   2) 若读取不到，再用 youtubei.js 兜底；
// //   3) 不要求 url 存在（signatureCipher 也纳入）；
// //   4) 仅做 mp4/webm 筛选；生成 label/value（value=itag 或 itag+itag）。
//
// import type { Innertube as ITube, UniversalCache as UCache } from 'youtubei.js/web';
// let Innertube: typeof ITube | null = null;
// let UniversalCache: typeof UCache | null = null;
//
// type DlItem = {
//     label: string;
//     value: string;        // 直接给 yt-dlp -f
//     height?: number;
//     kind: 'merge' | 'single';
// };
//
// const ALLOWED_EXT = new Set(['mp4', 'webm']);
// const MIN_HEIGHT = 144;
//
// function codecTagFromMime(mime?: string): string {
//     if (!mime) return '?';
//     const m = mime.match(/codecs="([^"]+)"/i);
//     const c = (m?.[1] || '').toLowerCase();
//     if (c.startsWith('avc1')) return 'AVC';
//     if (c.startsWith('vp9'))  return 'VP9';
//     if (c.startsWith('av01')) return 'AV1';
//     return c || '?';
// }
//
// function extFromMime(mime?: string): 'mp4' | 'webm' | string {
//     if (!mime) return '';
//     if (mime.includes('mp4')) return 'mp4';
//     if (mime.includes('webm')) return 'webm';
//     return '';
// }
//
// function heightOf(fmt: any): number {
//     if (typeof fmt?.height === 'number') return fmt.height;
//     const ql: string = fmt?.qualityLabel || fmt?.quality_label || '';
//     const m = ql.match(/(\d{3,4})p/i);
//     return m ? parseInt(m[1], 10) : 0;
// }
//
// function currentVideoIdFromUrl(href = location.href): string | undefined {
//     try {
//         const u = new URL(href);
//         const v = u.searchParams.get('v');
//         if (v) return v;
//         const shorts = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{10,})/);
//         if (shorts) return shorts[1];
//         const emb = u.pathname.match(/\/embed\/([A-Za-z0-9_-]{10,})/);
//         if (emb) return emb[1];
//     } catch {}
//     return undefined;
// }
//
// /* ---------- 1) 从页面读取 playerResponse（formats/adaptiveFormats） ---------- */
//
// function readPlayerResponseFromWindow(): any | null {
//     const w = window as any;
//     if (w.ytInitialPlayerResponse?.streamingData) return w.ytInitialPlayerResponse;
//
//     const watchFlexy = document.querySelector('ytd-watch-flexy') as any;
//     if (watchFlexy?.playerResponse?.streamingData) return watchFlexy.playerResponse;
//
//     const ytdPlayer = document.querySelector('ytd-player') as any;
//     if (ytdPlayer?.playerResponse?.streamingData) return ytdPlayer.playerResponse;
//
//     // 兜底：从脚本里抓
//     for (const s of Array.from(document.scripts)) {
//         const txt = s.textContent || '';
//         if (!txt.includes('ytInitialPlayerResponse')) continue;
//         const m =
//             txt.match(/ytInitialPlayerResponse"\]?\s*=\s*(\{.*?\});/s) ||
//             txt.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
//         if (m) {
//             try {
//                 const obj = JSON.parse(m[1]);
//                 if (obj?.streamingData) return obj;
//             } catch {}
//         }
//     }
//     return null;
// }
//
// /* ---------- 2) youtubei.js 兜底：只取 itag/mime/height，不依赖 URL ---------- */
//
// async function ensureYT(): Promise<void> {
//     if (Innertube && UniversalCache) return;
//     const mod = await import('youtubei.js/web');
//     // @ts-ignore
//     Innertube = mod.Innertube;
//     // @ts-ignore
//     UniversalCache = mod.UniversalCache;
// }
//
// async function fetchViaYT(videoId: string) {
//     await ensureYT();
//     const boundFetch: typeof fetch = (...args) => (globalThis.fetch as any)(...args);
//
//     // @ts-ignore
//     const yt = await (Innertube as any).create({
//         cache: new (UniversalCache as any)(true),
//         fetch: boundFetch,
//         generate_session_locally: true,
//     });
//
//     // 多客户端并发，谁有就用谁
//     const settled = await Promise.allSettled([
//         yt.getInfo(videoId, 'WEB' as any),
//         yt.getInfo(videoId, 'ANDROID' as any),
//         yt.getInfo(videoId, 'TV' as any),
//     ]);
//
//     const infos: any[] = [];
//     for (const r of settled) if (r.status === 'fulfilled' && r.value?.streaming_data) infos.push(r.value);
//
//     const title = infos.find(i => i.basic_info?.title)?.basic_info?.title || '';
//
//     const formats: any[] = [];
//     for (const info of infos) {
//         const f = info.streaming_data;
//         if (f?.formats)         formats.push(...f.formats.map((x: any) => ({ ...x, __progressive: true })));
//         if (f?.adaptive_formats) formats.push(...f.adaptive_formats.map((x: any) => ({ ...x, __progressive: false })));
//     }
//
//     // 去重（itag+mime），保留 progressive 优先
//     const map = new Map<string, any>();
//     for (const f of formats) {
//         const key = `${String(f.itag || '')}|${f.mime_type || ''}`;
//         if (!map.has(key)) map.set(key, f);
//         else if (!map.get(key).__progressive && f.__progressive) map.set(key, f);
//     }
//
//     return { title, formats: Array.from(map.values()) };
// }
//
// /* ---------- 3) 生成 items（不要求 url 存在） ---------- */
//
// function buildItemsFromPR(pr: any): { title: string; items: DlItem[] } {
//     const title =
//         pr?.videoDetails?.title ||
//         pr?.microformat?.playerMicroformatRenderer?.title?.simpleText ||
//         '';
//
//     const progressiveSrc = pr?.streamingData?.formats || [];
//     const adaptiveSrc    = pr?.streamingData?.adaptiveFormats || [];
//
//     const videoOnly: Array<{ itag: string; height: number; mime: string }> = [];
//     const audioOnly: Array<{ itag: string; mime: string; abr?: number }> = [];
//     const progressive: Array<{ itag: string; height: number; mime: string }> = [];
//
//     // progressive：直接来自 formats
//     for (const f of progressiveSrc) {
//         const itag = String(f?.itag || '');
//         const mime = f?.mimeType || f?.mime_type || '';
//         if (!itag || !mime) continue;
//         const ext = extFromMime(mime);
//         if (!ALLOWED_EXT.has(ext)) continue;
//         const h = heightOf(f);
//         if (h >= MIN_HEIGHT) progressive.push({ itag, height: h, mime });
//     }
//
//     // adaptive：分离音/视频
//     for (const f of adaptiveSrc) {
//         const itag = String(f?.itag || '');
//         const mime = f?.mimeType || f?.mime_type || '';
//         if (!itag || !mime) continue;
//         const ext = extFromMime(mime);
//         if (!ALLOWED_EXT.has(ext)) continue;
//
//         const isVideoTrack = mime.startsWith('video/');
//         const isAudioTrack = mime.startsWith('audio/');
//         if (isVideoTrack && !isAudioTrack) {
//             const h = heightOf(f);
//             if (h >= MIN_HEIGHT) videoOnly.push({ itag, height: h, mime });
//         } else if (isAudioTrack && !isVideoTrack) {
//             const abr = f.bitrate || f.averageBitrate || f.average_bitrate || 0;
//             audioOnly.push({ itag, mime, abr });
//         }
//     }
//
//     // 选音频 itag
//     const audioMap = new Map(audioOnly.map(a => [a.itag, a]));
//     let preferredAudio = audioMap.get('140');
//     if (!preferredAudio) {
//         const bestMp4 = audioOnly
//             .filter(a => extFromMime(a.mime) === 'mp4')
//             .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
//         preferredAudio = bestMp4 || audioOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
//     }
//
//     const items: DlItem[] = [];
//     if (preferredAudio) {
//         for (const v of videoOnly) {
//             items.push({
//                 label: `${v.height}p ${codecTagFromMime(v.mime)} (merge)`,
//                 value: `${v.itag}+${preferredAudio.itag}`,
//                 height: v.height,
//                 kind: 'merge',
//             });
//         }
//     }
//
//     for (const p of progressive) {
//         const ext = extFromMime(p.mime).toUpperCase();
//         items.push({
//             label: `${p.height}p ${ext} (progressive)`,
//             value: `${p.itag}`,
//             height: p.height,
//             kind: 'single',
//         });
//     }
//
//     items.sort((a, b) => {
//         const ha = a.height || 0, hb = b.height || 0;
//         if (hb !== ha) return hb - ha;
//         const aSingle = a.kind === 'single' ? 1 : 0;
//         const bSingle = b.kind === 'single' ? 1 : 0;
//         return bSingle - aSingle;
//     });
//
//     const uniq = new Map<string, DlItem>();
//     for (const it of items) if (!uniq.has(it.value)) uniq.set(it.value, it);
//
//     return { title, items: Array.from(uniq.values()) };
// }
//
// function buildItemsFromYTInfo(info: { title: string; formats: any[] }) {
//     const { title, formats } = info;
//     const prog: any[] = [];
//     const vOnly: any[] = [];
//     const aOnly: any[] = [];
//
//     for (const f of formats) {
//         const itag = String(f?.itag || '');
//         const mime = f?.mime_type || f?.mimeType || '';
//         if (!itag || !mime) continue;
//         const ext = extFromMime(mime);
//         if (!ALLOWED_EXT.has(ext)) continue;
//
//         if (f.__progressive) {
//             const h = heightOf(f);
//             if (h >= MIN_HEIGHT) prog.push({ itag, height: h, mime });
//         } else {
//             const isVideo = mime.startsWith('video/');
//             const isAudio = mime.startsWith('audio/');
//             if (isVideo && !isAudio) {
//                 const h = heightOf(f);
//                 if (h >= MIN_HEIGHT) vOnly.push({ itag, height: h, mime });
//             } else if (isAudio && !isVideo) {
//                 const abr = f.bitrate || f.average_bitrate || f.averageBitrate || 0;
//                 aOnly.push({ itag, mime, abr });
//             }
//         }
//     }
//
//     let preferred = aOnly.find(a => a.itag === '140');
//     if (!preferred) {
//         const bestMp4 = aOnly.filter(a => extFromMime(a.mime) === 'mp4')
//             .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
//         preferred = bestMp4 || aOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
//     }
//
//     const items: DlItem[] = [];
//     if (preferred) {
//         for (const v of vOnly) {
//             items.push({
//                 label: `${v.height}p ${codecTagFromMime(v.mime)} (merge)`,
//                 value: `${v.itag}+${preferred.itag}`,
//                 height: v.height,
//                 kind: 'merge',
//             });
//         }
//     }
//     for (const p of prog) {
//         const ext = extFromMime(p.mime).toUpperCase();
//         items.push({
//             label: `${p.height}p ${ext} (progressive)`,
//             value: `${p.itag}`,
//             height: p.height,
//             kind: 'single',
//         });
//     }
//
//     items.sort((a, b) => {
//         const ha = a.height || 0, hb = b.height || 0;
//         if (hb !== ha) return hb - ha;
//         if (a.kind !== b.kind) return a.kind === 'merge' ? -1 : 1;
//         return 0;
//     });
//     const uniq = new Map<string, DlItem>();
//     for (const it of items) if (!uniq.has(it.value)) uniq.set(it.value, it);
//
//     return { title, items: Array.from(uniq.values()) };
// }
//
// /* ---------- 4) 统一入口 ---------- */
//
// async function collectFormats(videoId: string): Promise<{ title: string; items: DlItem[] }> {
//     const pr = readPlayerResponseFromWindow();
//     if (pr?.streamingData) {
//         const fromPR = buildItemsFromPR(pr);
//         if (fromPR.items.length) return fromPR;
//         // 就算 items 为空，也继续 youtubei.js 兜底
//     }
//
//     const info = await fetchViaYT(videoId);
//     return buildItemsFromYTInfo(info);
// }
//
// export async function getDownloadOptions(videoId?: string): Promise<{ title: string; items: DlItem[] }> {
//     const vid = videoId || currentVideoIdFromUrl();
//     if (!vid) throw new Error('No videoId found from URL');
//     return collectFormats(vid);
// }
//
// // 控制台测试：await __YT_getDlOptions()
// ;(window as any).__YT_getDlOptions = getDownloadOptions;
