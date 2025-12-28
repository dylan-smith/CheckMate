# CheckMate Web

This is a Next.js web application for managing templates in CheckMate.

## Getting Started

First, install the dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Environment Variables

Create a `.env.local` file in the root directory with the following:

```
NEXT_PUBLIC_API_URL=https://localhost:7001
```

This should point to your CheckMate.WebApi backend URL.

## Features

- View all templates
- Create new templates
- Edit existing templates
- Delete templates

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- CSS Modules
