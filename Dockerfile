FROM node:5-onbuild

ENTRYPOINT ["./node_modules/.bin/babel-node", "src/main.js", "config.json"]
