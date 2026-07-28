FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Drop root — run as the unprivileged node user shipped in the base image
USER node

EXPOSE 7000

CMD ["node", "index.js"]
