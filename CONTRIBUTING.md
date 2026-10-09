# Contributing

Thanks for helping. Bug reports, fixes and new features are all welcome, and so is using AI to write them.

## Setting up

You need Node 20 or later.

```bash
npm install
npm run check
```

`npm run check` typechecks, runs every test, builds `dist/`, and checks the package works from both ES modules and CommonJS. It must pass before a pull request is merged.

## The one rule: same output as Go

This package is a port of [bedrock-skin-go](https://github.com/THEBOSS9345/bedrock-skin-go), and both must draw the same pixels. The tests compare every render, animation frame, pose, report and query against output the Go library wrote, in `testdata/`.

So:

- **A bug that is also in Go** is fixed in Go first. Then regenerate the fixtures and fix it here until the tests pass.
- **A bug only here** (the port differs from Go) is fixed here. Add a case to the tests that would have caught it.
- **Something that only exists in JavaScript** - the API's shape, the build, the types, browser support - is fixed here alone.

To regenerate the fixtures after a Go change, with Go installed, update the version in `tools/parity/go.mod`, then:

```bash
cd tools/parity && go run .
```

Never edit `testdata/` by hand.

## Before you change maths or parsing

Read [AGENTS.md](AGENTS.md). It lists the places where the code looks like it could be simpler but must not be: JavaScript's own `Math` functions, operation order, `JSON.parse` and string comparison all differ from Go in ways that change the output.

## When a test fails

A failing render test saves the port's image in `test-output/`, next to the Go version's in `testdata/`, to compare by eye. The message says how many pixels differ, and by how much.
