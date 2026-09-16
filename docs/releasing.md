# Release procedure

The checkout is prepared to build an npm package and a static playground. This work does not publish either artifact.

## Release identity

The project is licensed under MIT; retain the root `LICENSE` file in source and package distributions. Bundled dependencies retain their own licenses in `THIRD_PARTY_NOTICES.md`.

The source repository is [NicoAvanzDev/gpu-md](https://github.com/NicoAvanzDev/gpu-md). Repository, homepage, issue tracker, and maintainer metadata are recorded in `package.json`; private vulnerability reporting is documented in `SECURITY.md`. Confirm that the intended npm name or scope is available to the publishing account before publishing a package.

## Validate the candidate

```sh
npm ci
npm run validate
npx --no-install agent-browser install
npm run test:browser
npm run test:production
npm audit
npm pack --dry-run
npm pack
```

`npm pack` rebuilds the library through `prepack`. `npm publish` invokes the validation gate through `prepublishOnly`. Browser checks require a browser installation and run separately; CI includes both. Inspect the tarball and verify the correct version before using `npm publish` from the authorized publishing account. Publishing is a separate owner action.

The package smoke test installs a tarball with scripts disabled in an isolated temporary project, imports its actual ESM entrypoint, and compiles declarations in NodeNext and Bundler modes without DOM/WebGPU type packages. Only the allowlisted library, documentation, notices, and measurement summaries may enter the tarball. No training files, credentials, or playground fonts are shipped with the library.

For package metadata and declarations, see the official [npm package.json reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) and [TypeScript declaration guidance](https://www.typescriptlang.org/tsconfig/declaration.html). The standalone build follows [Vite library mode](https://vite.dev/guide/build.html#library-mode).

## Deploy the playground

`npm run build:site` produces `dist/`. Upload that directory to an HTTPS static host. Relative asset paths support subdirectory hosting; `npm run test:production` checks `/demo/`, including the emitted worker, fonts, and editor rendering. Ship `FONT_NOTICES.txt` with the site. No backend, environment secrets, or inference service is required.

WebGPU depends on browser and adapter support. Keep auto fallback visible and test any target browser/hardware before claiming GPU support or performance. The recorded graph intentionally retains its original measurement date and build hash; refresh it only through a verified hardware benchmark.

If adding a Content Security Policy, account for workers, local fonts, and the dynamic inline style values used by the benchmark graph and table alignment. Tailor image/navigation restrictions to the host application's needs.

## Release evidence

Retain the CI result, packed artifact listing, conformance counts, and browser reports in release records. Current unit/package checks run without GPU hardware. Linux browser tests use software WebGPU; CUDA and physical-adapter performance must be verified separately when changed or claimed.
