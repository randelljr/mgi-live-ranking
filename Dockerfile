FROM mcr.microsoft.com/playwright:v1.51.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
CMD ["npm","start"]
