== @housef4/db + @housef4/backend (tsc + Lambda bundle)
Scope: 2 of 4 workspace projects
db build$ tsc
db build: Done
backend build$ tsc && pnpm run build:lambda
backend build: > @housef4/backend@1.0.0 build:lambda /home/william/code/personal/2025/housef4/backend
backend build: > esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-lambda/index.js --log-level=warning
backend build: Done
== frontend (VITE_* from Terraform outputs)
