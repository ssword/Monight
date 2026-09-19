# Painted Monight app icon

The active icon is `monight-painted-1024.png`, adapted from
`monight-brand_assets/a3509517-miora_edit_image-1789473560137-0-f8d2aad4dd52.jpg`.
It preserves the painted M and crescent moon, removes the wordmark and tagline,
and enlarges the mark for use at app-icon sizes.

Created with the built-in image generation tool; normalized to 1024 × 1024 with
macOS `sips`. Run `npm run icons:generate` to regenerate all platform assets in
`src-tauri/icons`. The generator adds rounded corners and a transparent inset
for macOS ICNS using the native default preview. The old Icon Composer source
remains archived but is not bundled.

## Native macOS 27 icon

`Monight.icon` is the active native Icon Composer document. Its transparent
painted M and crescent foreground sits above an automatic midnight-blue gradient.
The moon stays embedded in the painted foreground to preserve its brushwork;
it is not a separate glass layer. The foreground group uses subtle translucency
(0.08) and a neutral shadow (0.25).

`previews/` contains all six appearances rendered by Apple's Icon Composer with
`--platform macOS --design-generation 27`: Default, Dark, ClearLight, ClearDark,
TintedLight, and TintedDark. Clear and tinted variants are system-generated from
the same artwork; actual tint and background depend on the user's appearance.

Run `npm run icons:macos` with a current full Xcode installation selected through
`xcode-select` to refresh these previews and the platform icons. Ordinary
`npm run icons:generate` reuses the saved previews and works without Icon Composer.
The macOS Tauri configuration bundles this `.icon` source for compilation into
`Assets.car`; the ICNS remains available as a static fallback.

Verified on macOS 27.0 with Xcode 27.0: the document opens and saves in Icon
Composer, all six previews render, the frontend and Rust debug builds pass,
and Tauri successfully packages `Monight.app` with `Assets.car` and
`CFBundleIconName = Icon`. The catalog contains the transparent painted
foreground and native icon stack. This verification builds a local app bundle;
it does not replace `/Applications/Monight.app`.

The transparent foreground was created with the built-in image generation tool
using this prompt:

> Use case: background-extraction. Edit target: supplied Monight painted M app icon. Remove ONLY the midnight navy background and its glow to make a genuinely transparent PNG. Preserve the entire painted M and embedded ivory crescent moon, their exact positioning, silhouette, brush textures, silver blue, pink and golden colors. Keep 1024x1024 square canvas and identical centered composition and margins. All negative space outside and inside the M must be truly transparent, including below the diagonals and above the center valley. No opaque background, no checkerboard baked into image, no new shadow, no outline, no text. This is a foreground layer for Apple Icon Composer; keep the moon and M together as the original painted artwork.

## Generation prompt

Use case: logo-brand. Asset type: production app icon for Monight, square 1024 x 1024. Input image: edit target and authoritative brand artwork. Adapt this supplied image into an app icon: preserve the recognizable painted metallic pale blue/silver M, warm ivory crescent moon embedded on its right diagonal, impasto brushwork, subtle pink and gold accents, and very dark midnight navy backdrop. Remove all text below the M, including Monight and READ BY MOONLIGHT. Enlarge and optically center the M alone so it occupies approximately 74% of the canvas width and 60% of its height. Use a full bleed square opaque midnight navy background with subtle central glow, no rounded outer corners or transparent padding (platform packaging will handle the mask). Keep the exact character and silhouette of the supplied M and crescent, refine edge clarity for small sizes. No new symbols, no words, no border, no mockup, no extra objects. Deliver only the square icon artwork.
