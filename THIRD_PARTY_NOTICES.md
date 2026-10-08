# Third-party notices

Aaron Campbell reserves rights only to his original application material. Third-party libraries, fonts and icons retain their own copyrights, licenses and granted rights; the application notice does not relicense or restrict them. Full texts and provenance are recorded in the [inventory](third-party-licenses/manifest.json).

## Distribution contents

Both `npm run build` and `npm run build:pwa` copy this notice, the original-work [LICENSE](LICENSE), the dependency inventory and all preserved license texts to `web/dist/pwa/`. The Docker image includes the same notice files under `/app/`, the PWA notices, and the installed API packages with their published notices/source. Recipients can read the PWA notice at `/THIRD_PARTY_NOTICES.md` and full texts under `/third-party-licenses/`; distributors must retain them when repackaging.

**Lora and DM Sans use SIL Open Font License 1.1.** Their full Fontsource copyright/license texts accompany the built WOFF/WOFF2 fonts. Lora credits the Lora Project Authors (2011), with Reserved Font Name Lora; DM Sans credits the DM Sans Project Authors (2014). The fonts retain OFL and any applicable reserved-name requirements. Separate application code does not become OFL solely by embedding them. See the [official OFL text](https://openfontlicense.org/open-font-license-official-text/).

React, Phosphor icons, Radix UI and their browser dependencies retain the permissive terms in the inventory. Activity marks use those licensed packages. The app's install icons are original procedural bottle drawings created on October 8, 2026 by `web/scripts/generate-app-icons.mjs`; no reference image, downloaded bitmap, font or third-party logo is used. See [asset provenance](web/public/APP_ASSETS.md).

`react-remove-scroll-bar` is pinned to **2.3.7** because the previous 2.3.8 package omitted full license text and its published source revision could not be retrieved. The retained MIT text credits Anton Korzunov (2025) and comes from upstream revision `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`, whose `package.json` declares 2.3.7. This is recorded as version-verified upstream source evidence, not as the npm release gitHead; the historical version tag also omitted LICENSE.

## Server dependencies and MPL source access

`web-push` **3.6.7** is an unmodified MPL-2.0 API dependency. Its package notice and the [full MPL-2.0 text](third-party-licenses/MPL-2.0.txt) are preserved. Recipients of the Docker image can obtain its covered JavaScript source directly at `/app/api/node_modules/web-push`, or from [web-push v3.6.7 source](https://github.com/web-push-libs/web-push/tree/v3.6.7) and the [exact npm source package](https://registry.npmjs.org/web-push/-/web-push-3.6.7.tgz). The original-work restrictions do not apply to these MPL files. Retain MPL rights and notices if modifying or redistributing covered files; separate original application files keep their own terms. See [Mozilla's explanation](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

`pg`, `http_ece` and other API dependencies retain the recorded permissive terms. `http_ece` 1.2.0 omitted its full MIT file in the installed package; the preserved exact published-revision upstream text credits Martin Thomson (2015). The copied texts retain their original copyrights.

`lightningcss` **1.32.0** and its platform bindings are MPL-2.0 build tools, rather than application CSS being licensed merely through tool use. Preserve those tool terms if distributing the tool itself. Development/test packages below may be absent from a runtime build; including their notices does not claim they are all bundled.

## Removed material and publication history

Eight downloaded Nara/Everyday Industries research screenshots were removed from this candidate because source attribution did not establish public redistribution permission. The [research index](docs/references/README.md) retains external links and original observations, without copied publisher images. The legacy phone-frame prototype/runtime, simulated keyboard, unverified device/status images and related Sites worker/fixtures were also removed. The implemented native PWA's care workflows remain the supported application. Previously unverified app icon PNGs were replaced with the procedural drawing above, and the diaper bitmap was removed in favor of a licensed icon component.

Real Owlet authentication now requires explicitly configured provider client values that the deployer is authorized to use. No third-party mobile application's Firebase key, Ayla shared app secret or Android client identity is bundled. The optional integration stays disabled when these values are missing; synthetic demo graphs need no provider credentials. This configuration requirement does not itself grant access to any provider service.

**These removals do not remove earlier Git history.** A public release must use the separately prepared clean snapshot or documented permission covering the old copies. This candidate has not rewritten history or been deployed. Owlet, Nara and other names/marks retain their owners' rights; no branding permission is granted here.

## Inventory limits

The inventory records the inspected locked packages and preserved full texts, updated October 8, 2026. It includes development tooling, so it is not an exact tree-shaken bundle list. Platform packages absent locally were not unpacked; this is not a complete base-image/operating-system inventory or retrospective authorship review. Recheck notices when dependencies or release contents change. Identical license texts are stored once.

<details>
<summary>web dependency inventory (56 packages)</summary>

| Component | Version | License | Lock flag | Evidence |
| --- | --- | --- | --- | --- |
| `@fontsource/dm-sans` | `5.3.0` | OFL-1.1 | declared non-dev | [source](https://github.com/fontsource/font-files) · [text 1](third-party-licenses/texts/6fbd040a29c2037a765d--LICENSE) |
| `@fontsource/lora` | `5.3.0` | OFL-1.1 | declared non-dev | [source](https://github.com/fontsource/font-files) · [text 1](third-party-licenses/texts/948aed765160f7b97410--LICENSE) |
| `@oxc-project/types` | `0.139.0` | MIT | dev/build | [source](https://github.com/oxc-project/oxc) · [text 1](third-party-licenses/texts/95ced5ecf1133fbf41d4--LICENSE) |
| `@phosphor-icons/react` | `2.1.10` | MIT | declared non-dev | [source](https://github.com/phosphor-icons/react) · [text 1](third-party-licenses/texts/6918b72504641180600c--LICENSE) |
| `@playwright/test` | `1.61.1` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/playwright) · [text 1](third-party-licenses/texts/45873d00a0dd243596de--LICENSE) · [text 2](third-party-licenses/texts/6d602191187b35b9b01d--NOTICE) |
| `@radix-ui/primitive` | `1.1.5` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-compose-refs` | `1.1.3` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-context` | `1.2.0` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-dialog` | `1.1.19` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-dismissable-layer` | `1.1.15` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-focus-guards` | `1.1.4` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-focus-scope` | `1.1.12` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-icons` | `1.3.2` | MIT | declared non-dev | [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-id` | `1.1.2` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-portal` | `1.1.13` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-presence` | `1.1.7` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-primitive` | `2.1.7` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-slot` | `1.3.0` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-use-callback-ref` | `1.1.2` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-use-controllable-state` | `1.2.3` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-use-effect-event` | `0.0.3` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@radix-ui/react-use-layout-effect` | `1.1.2` | MIT | declared non-dev | [source](https://github.com/radix-ui/primitives) · [text 1](third-party-licenses/texts/0e80a2d229d2fd4fc7e8--LICENSE) |
| `@rolldown/binding-linux-x64-gnu` | `1.1.5` | MIT | dev/build | [source](https://github.com/rolldown/rolldown) · [text 1](third-party-licenses/texts/23ecfff35a5a2e80d921--LICENSE) |
| `@rolldown/pluginutils` | `1.0.1` | MIT | dev/build | [source](https://github.com/rolldown/plugins) · [text 1](third-party-licenses/texts/e1919b3b98b8bf6c1b99--LICENSE) |
| `@types/react` | `19.2.17` | MIT | declared non-dev | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) · [text 1](third-party-licenses/texts/c2cfccb812fe482101a8--LICENSE) |
| `@types/react-dom` | `19.2.3` | MIT | declared non-dev | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) · [text 1](third-party-licenses/texts/c2cfccb812fe482101a8--LICENSE) |
| `@typescript/typescript-linux-x64` | `7.0.2` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/TypeScript) · [text 1](third-party-licenses/texts/a7d00bfd54525bc694b6--LICENSE) · [text 2](third-party-licenses/texts/f5c708b59114507b8b27--NOTICE.txt) |
| `@vitejs/plugin-react` | `6.0.3` | MIT | dev/build | [source](https://github.com/vitejs/vite-plugin-react) · [text 1](third-party-licenses/texts/29b68325fe026047d13e--LICENSE) |
| `aria-hidden` | `1.2.6` | MIT | declared non-dev | [source](https://github.com/theKashey/aria-hidden) · [text 1](third-party-licenses/texts/30f0cfddf483d1128e36--LICENSE) |
| `csstype` | `3.2.3` | MIT | declared non-dev | [source](https://github.com/frenic/csstype) · [text 1](third-party-licenses/texts/11d55bd4541c75ee7879--LICENSE) |
| `detect-libc` | `2.1.2` | Apache-2.0 | dev/build | [source](https://github.com/lovell/detect-libc) · [text 1](third-party-licenses/texts/b40930bbcf80744c86c4--LICENSE) |
| `detect-node-es` | `1.1.0` | MIT | declared non-dev | [source](https://github.com/thekashey/detect-node) · [text 1](third-party-licenses/texts/54b32293ea560d22cd9b--LICENSE) |
| `fdir` | `6.5.0` | MIT | dev/build | [source](https://github.com/thecodrr/fdir) · [text 1](third-party-licenses/texts/9a39f2aadab11a3697ed--LICENSE) |
| `get-nonce` | `1.0.1` | MIT | declared non-dev | [source](https://github.com/theKashey/get-nonce) · [text 1](third-party-licenses/texts/acf3b087b348d2f2e731--LICENSE) |
| `lightningcss` | `1.32.0` | MPL-2.0 | dev/build | [source](https://github.com/parcel-bundler/lightningcss) · [text 1](third-party-licenses/texts/5eba353fe5076ac34321--LICENSE) |
| `lightningcss-linux-x64-gnu` | `1.32.0` | MPL-2.0 | dev/build | [source](https://github.com/parcel-bundler/lightningcss) · [text 1](third-party-licenses/texts/5eba353fe5076ac34321--LICENSE) |
| `nanoid` | `3.3.20` | MIT | dev/build | [source](https://github.com/ai/nanoid) · [text 1](third-party-licenses/texts/da4db1480d9beea3483a--LICENSE) |
| `picocolors` | `1.1.1` | ISC | dev/build | [source](https://github.com/alexeyraspopov/picocolors) · [text 1](third-party-licenses/texts/6582629e2979466878f6--LICENSE) |
| `picomatch` | `4.0.5` | MIT | dev/build | [source](https://github.com/micromatch/picomatch) · [text 1](third-party-licenses/texts/d0cd141b0c322fded5df--LICENSE) |
| `playwright` | `1.61.1` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/playwright) · [text 1](third-party-licenses/texts/45873d00a0dd243596de--LICENSE) · [text 2](third-party-licenses/texts/6d602191187b35b9b01d--NOTICE) · [text 3](third-party-licenses/texts/b17ac0bd6f4b8207e440--ThirdPartyNotices.txt) |
| `playwright-core` | `1.61.1` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/playwright) · [text 1](third-party-licenses/texts/45873d00a0dd243596de--LICENSE) · [text 2](third-party-licenses/texts/6d602191187b35b9b01d--NOTICE) · [text 3](third-party-licenses/texts/a549d329bad8806fe279--ThirdPartyNotices.txt) |
| `postcss` | `8.5.29` | MIT | dev/build | [source](https://github.com/postcss/postcss) · [text 1](third-party-licenses/texts/5be1f3465bba68a62677--LICENSE) |
| `react` | `19.2.7` | MIT | declared non-dev | [source](https://github.com/facebook/react) · [text 1](third-party-licenses/texts/da6d3703ed11cbe42bd2--LICENSE) |
| `react-dom` | `19.2.7` | MIT | declared non-dev | [source](https://github.com/facebook/react) · [text 1](third-party-licenses/texts/da6d3703ed11cbe42bd2--LICENSE) |
| `react-remove-scroll` | `2.7.2` | MIT | declared non-dev | [source](https://github.com/theKashey/react-remove-scroll) · [text 1](third-party-licenses/texts/30f0cfddf483d1128e36--LICENSE) |
| `react-remove-scroll-bar` | `2.3.7` | MIT | declared non-dev | [source](https://github.com/theKashey/react-remove-scroll-bar) · [text 1](third-party-licenses/texts/a79aae0c0f21990d9d96--LICENSE) |
| `react-style-singleton` | `2.2.3` | MIT | declared non-dev | [source](https://github.com/theKashey/react-style-singleton) · [text 1](third-party-licenses/texts/30f0cfddf483d1128e36--LICENSE) |
| `rolldown` | `1.1.5` | MIT | dev/build | [source](https://github.com/rolldown/rolldown) · [text 1](third-party-licenses/texts/23ecfff35a5a2e80d921--LICENSE) |
| `scheduler` | `0.27.0` | MIT | declared non-dev | [source](https://github.com/facebook/react) · [text 1](third-party-licenses/texts/da6d3703ed11cbe42bd2--LICENSE) |
| `source-map-js` | `1.2.2` | BSD-3-Clause | dev/build | [source](https://github.com/7rulnik/source-map-js) · [text 1](third-party-licenses/texts/6cb0631f71c7749763fd--LICENSE) |
| `tinyglobby` | `0.2.17` | MIT | dev/build | [source](https://github.com/SuperchupuDev/tinyglobby) · [text 1](third-party-licenses/texts/22c68811e174cbbfb381--LICENSE) |
| `tslib` | `2.8.1` | 0BSD | declared non-dev | [source](https://github.com/Microsoft/tslib) · [text 1](third-party-licenses/texts/da16ddb65f8ca390998f--CopyrightNotice.txt) · [text 2](third-party-licenses/texts/210b19e543130388c686--LICENSE.txt) |
| `typescript` | `7.0.2` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/TypeScript) · [text 1](third-party-licenses/texts/a7d00bfd54525bc694b6--LICENSE) · [text 2](third-party-licenses/texts/f5c708b59114507b8b27--NOTICE.txt) |
| `use-callback-ref` | `1.3.3` | MIT | declared non-dev | [source](https://github.com/theKashey/use-callback-ref/) · [text 1](third-party-licenses/texts/30f0cfddf483d1128e36--LICENSE) |
| `use-sidecar` | `1.1.3` | MIT | declared non-dev | [source](https://github.com/theKashey/use-sidecar) · [text 1](third-party-licenses/texts/30f0cfddf483d1128e36--LICENSE) |
| `vite` | `8.1.3` | MIT | dev/build | [source](https://github.com/vitejs/vite) · [text 1](third-party-licenses/texts/b1d741c26b53de1bbc0d--LICENSE.md) |

</details>

<details>
<summary>api dependency inventory (38 packages)</summary>

| Component | Version | License | Lock flag | Evidence |
| --- | --- | --- | --- | --- |
| `@types/node` | `22.20.3` | MIT | dev/build | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) · [text 1](third-party-licenses/texts/c2cfccb812fe482101a8--LICENSE) |
| `@types/pg` | `8.23.1` | MIT | dev/build | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) · [text 1](third-party-licenses/texts/c2cfccb812fe482101a8--LICENSE) |
| `@types/web-push` | `3.6.4` | MIT | dev/build | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) · [text 1](third-party-licenses/texts/c2cfccb812fe482101a8--LICENSE) |
| `@typescript/typescript-linux-x64` | `7.0.2` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/TypeScript) · [text 1](third-party-licenses/texts/a7d00bfd54525bc694b6--LICENSE) · [text 2](third-party-licenses/texts/f5c708b59114507b8b27--NOTICE.txt) |
| `agent-base` | `7.1.4` | MIT | declared non-dev | [source](https://github.com/TooTallNate/proxy-agents) · [text 1](third-party-licenses/texts/8d8c55319c7729d57be8--LICENSE) |
| `asn1.js` | `5.4.1` | MIT | declared non-dev | [source](https://github.com/indutny/asn1.js) · [text 1](third-party-licenses/texts/251ecdcdb2bafa7b1061--LICENSE) |
| `bn.js` | `4.12.5` | MIT | declared non-dev | [source](https://github.com/indutny/bn.js) · [text 1](third-party-licenses/texts/445739f5b5eb63e5aeff--LICENSE) |
| `buffer-equal-constant-time` | `1.0.1` | BSD-3-Clause | declared non-dev | [source](https://github.com/goinstant/buffer-equal-constant-time) · [text 1](third-party-licenses/texts/751d0e80fb5c828f8c3d--LICENSE.txt) |
| `debug` | `4.4.3` | MIT | declared non-dev | [source](https://github.com/debug-js/debug) · [text 1](third-party-licenses/texts/3a61c6c96caf5c1d9b62--LICENSE) |
| `ecdsa-sig-formatter` | `1.0.11` | Apache-2.0 | declared non-dev | [text 1](third-party-licenses/texts/50a6b24f8defc31a078a--LICENSE) |
| `http_ece` | `1.2.0` | MIT | declared non-dev | [source](https://github.com/martinthomson/encrypted-content-encoding) · [text 1](third-party-licenses/texts/717363ac0c7f08830428--http_ece-1.2.0-LICENSE) |
| `https-proxy-agent` | `7.0.6` | MIT | declared non-dev | [source](https://github.com/TooTallNate/proxy-agents) · [text 1](third-party-licenses/texts/8d8c55319c7729d57be8--LICENSE) |
| `inherits` | `2.0.4` | ISC | declared non-dev | [source](https://github.com/isaacs/inherits) · [text 1](third-party-licenses/texts/5ffe28e7ade7d8f10d85--LICENSE) |
| `jwa` | `2.0.1` | MIT | declared non-dev | [source](https://github.com/brianloveswords/node-jwa) · [text 1](third-party-licenses/texts/3320319f8a5f42bc4254--LICENSE) |
| `jws` | `4.0.1` | MIT | declared non-dev | [source](https://github.com/brianloveswords/node-jws) · [text 1](third-party-licenses/texts/3320319f8a5f42bc4254--LICENSE) |
| `minimalistic-assert` | `1.0.1` | ISC | declared non-dev | [source](https://github.com/calvinmetcalf/minimalistic-assert) · [text 1](third-party-licenses/texts/136fee1129ea96ce18b4--LICENSE) |
| `minimist` | `1.2.8` | MIT | declared non-dev | [source](https://github.com/minimistjs/minimist) · [text 1](third-party-licenses/texts/435a6722c786b0a56fbe--LICENSE) |
| `ms` | `2.1.3` | MIT | declared non-dev | [source](https://github.com/vercel/ms) · [text 1](third-party-licenses/texts/1662fae9b5314d11cf51--license.md) |
| `pg` | `8.23.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-postgres) · [text 1](third-party-licenses/texts/192b8f5c96900f04a127--LICENSE) |
| `pg-cloudflare` | `1.4.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-postgres) · [text 1](third-party-licenses/texts/192b8f5c96900f04a127--LICENSE) |
| `pg-connection-string` | `2.14.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-postgres) · [text 1](third-party-licenses/texts/2244b5486c4427001b67--LICENSE) |
| `pg-int8` | `1.0.1` | ISC | declared non-dev | [source](https://github.com/charmander/pg-int8) · [text 1](third-party-licenses/texts/4e8e87ccdfc7e4b47fd8--LICENSE) |
| `pg-pool` | `3.14.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-postgres) · [text 1](third-party-licenses/texts/4f15ee7fc2a72082859d--LICENSE) |
| `pg-protocol` | `1.16.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-postgres) · [text 1](third-party-licenses/texts/192b8f5c96900f04a127--LICENSE) |
| `pg-types` | `2.2.0` | MIT | declared non-dev | [source](https://github.com/brianc/node-pg-types) · [text 1](third-party-licenses/texts/c565667e0560bba6502c--README.md) |
| `pgpass` | `1.0.5` | MIT | declared non-dev | [source](https://github.com/hoegaarden/pgpass) · [text 1](third-party-licenses/texts/f660a02f22de943c8c28--README.md) |
| `postgres-array` | `2.0.0` | MIT | declared non-dev | [source](https://github.com/bendrucker/postgres-array) · [text 1](third-party-licenses/texts/f057f36739d53d228a74--license) |
| `postgres-bytea` | `1.0.1` | MIT | declared non-dev | [source](https://github.com/bendrucker/postgres-bytea) · [text 1](third-party-licenses/texts/f057f36739d53d228a74--license) |
| `postgres-date` | `1.0.7` | MIT | declared non-dev | [source](https://github.com/bendrucker/postgres-date) · [text 1](third-party-licenses/texts/f057f36739d53d228a74--license) |
| `postgres-interval` | `1.2.0` | MIT | declared non-dev | [source](https://github.com/bendrucker/postgres-interval) · [text 1](third-party-licenses/texts/f057f36739d53d228a74--license) |
| `prettier` | `3.9.7` | MIT | dev/build | [source](https://github.com/prettier/prettier) · [text 1](third-party-licenses/texts/b0f2417199889f1c0d28--LICENSE) · [text 2](third-party-licenses/texts/aaf6032babb49d6e5601--THIRD-PARTY-NOTICES.md) |
| `safe-buffer` | `5.2.1` | MIT | declared non-dev | [source](https://github.com/feross/safe-buffer) · [text 1](third-party-licenses/texts/c7cc929b57080f4b9d0c--LICENSE) |
| `safer-buffer` | `2.1.2` | MIT | declared non-dev | [source](https://github.com/ChALkeR/safer-buffer) · [text 1](third-party-licenses/texts/4bc935e71be198c67ddf--LICENSE) |
| `split2` | `4.2.0` | ISC | declared non-dev | [source](https://github.com/mcollina/split2) · [text 1](third-party-licenses/texts/c372ef2fa1dfcb124ed8--LICENSE) |
| `typescript` | `7.0.2` | Apache-2.0 | dev/build | [source](https://github.com/microsoft/TypeScript) · [text 1](third-party-licenses/texts/a7d00bfd54525bc694b6--LICENSE) · [text 2](third-party-licenses/texts/f5c708b59114507b8b27--NOTICE.txt) |
| `undici-types` | `6.21.0` | MIT | dev/build | [source](https://github.com/nodejs/undici) · [text 1](third-party-licenses/texts/a6db8096b2707bc0102d--LICENSE) |
| `web-push` | `3.6.7` | MPL-2.0 | declared non-dev | [source](https://github.com/web-push-libs/web-push) · [text 1](third-party-licenses/texts/1fe5dbc03ffe518da23f--LICENSE) |
| `xtend` | `4.0.2` | MIT | declared non-dev | [source](https://github.com/Raynos/xtend) · [text 1](third-party-licenses/texts/82e67379203d5794e7c4--LICENSE) |

</details>
