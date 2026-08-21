This is a Next.js hostel leave automation project.

## How It Works

1. A student submits one free-form leave request from the home page.
2. `app/api/leave-request/route.js` sends that text to Gemini, which extracts the leave fields, calculates the number of days, and writes a parent email draft.
3. The enriched request is saved as a new row in the Notion leave database with `Email Status` set to `Not_Sent`.
4. `app/api/cron-processor/route.js` is called automatically by Vercel every minute. It finds rows with `Status = Approve` and `Email Status = Not_Sent`.
5. The worker generates a gate pass ID and QR code, emails the parent and student, then changes `Email Status` to `Sent`. A failed row is marked `Error` so it is not repeatedly emailed.

## Required Environment Variables

Set these in `.env` for local development and in the Vercel project settings for deployment:

```env
GEMINI_API_KEY=your_gemini_key
NOTION_API_KEY=your_notion_integration_token
NOTION_LEAVE_DATABASE_ID=your_leave_database_id
NOTION_RUN_LOG_DB_ID=your_run_log_database_id
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_google_app_password
SMTP_FROM=your_email@gmail.com
CRON_SECRET=your_long_random_secret
```

`SMTP_PASSWORD` is a Google App Password, not the normal Gmail password. Share both Notion databases with the Notion integration. Keep `.env` private.

## Running Locally

```bash
cd hostel_leave_automation
npm install
npm run dev
```

The form is available at `http://localhost:3000`. The worker endpoint can be triggered manually with `curl` for testing, but Vercel invokes it automatically after deployment.

## Notion Status Values

The leave database uses these exact status values:

- `Not started`: initial state for a new request.
- `Approve`: the warden-approved state that enables email processing.
- `Not_Sent`: emails have not been dispatched yet.
- `Sent`: both emails were dispatched successfully.
- `Error`: processing failed for that row.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

thanks