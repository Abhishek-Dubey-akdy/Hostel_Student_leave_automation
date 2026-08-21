import { GoogleGenAI, Type } from "@google/genai";
import { Client } from "@notionhq/client";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const MODEL = "gemini-3.6-flash";
const MISSING = "MISSING/MALFORMED";
const leaveRequestSchema = {
  type: Type.OBJECT,
  properties: {
    student_name: { type: Type.STRING, nullable: true },
    room_number: { type: Type.STRING, nullable: true },
    destination: { type: Type.STRING, nullable: true },
    reason: { type: Type.STRING, nullable: true },
    out_date: { type: Type.STRING, nullable: true },
    in_date: { type: Type.STRING, nullable: true },
    student_email: { type: Type.STRING, nullable: true },
    parents_email: { type: Type.STRING, nullable: true },
    number_days: { type: Type.NUMBER, nullable: true },
    parent_draft_message: { type: Type.STRING, nullable: true },
    risk_level: { type: Type.STRING },
    email_status: { type: Type.STRING },
  },
  required: [
    "student_name", "room_number", "destination", "reason", "out_date",
    "in_date", "student_email", "parents_email", "number_days",
    "parent_draft_message", "risk_level", "email_status",
  ],
};

const richText = (value) => ({
  rich_text: value ? [{ text: { content: String(value) } }] : [],
});
const title = (value) => ({ title: [{ text: { content: value || MISSING } }] });
const status = (value) => ({ status: value ? { name: value } : null });
const select = (value) => ({ select: value ? { name: value } : null });
const number = (value) => ({ number: typeof value === "number" ? value : null });
const date = (value) => ({
  date: typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { start: value }
    : null,
});
const email = (value) => ({
  email: typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value
    : null,
});

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return error?.body?.message || error?.message || JSON.stringify(error);
}

function databaseId() {
  return process.env.NOTION_LEAVE_DATABASE_ID || process.env.NOTION_LEAVE_DB_ID;
}

function logsDatabaseId() {
  return process.env.NOTION_LOGS_DATABASE_ID || process.env.NOTION_RUN_LOG_DB_ID;
}

function normalize(value) {
  return {
    student_name: value?.student_name || MISSING,
    room_number: value?.room_number || MISSING,
    destination: value?.destination || MISSING,
    reason: value?.reason || MISSING,
    out_date: value?.out_date || null,
    in_date: value?.in_date || null,
    student_email: value?.student_email || null,
    parents_email: value?.parents_email || null,
    number_days: typeof value?.number_days === "number" ? value.number_days : null,
    parent_draft_message: value?.parent_draft_message || MISSING,
    risk_level: ["Low", "Medium", "High"].includes(value?.risk_level)
      ? value.risk_level
      : "Medium",
    email_status: "Not_Sent",
  };
}

function isMalformed(value) {
  return value.student_name === MISSING || !value.out_date || !value.in_date ||
    !value.student_email || !value.parents_email;
}

function applyRiskRules(value, rawText) {
  const text = `${rawText} ${value.reason}`.toLowerCase();
  const bereavementMentioned =
    /\b(died|dead|death|deceased|bereavement|funeral|last rites)\b/.test(text);

  // A serious family event is urgent, but urgency alone is not evidence of misuse.
  return bereavementMentioned ? { ...value, risk_level: "Low" } : value;
}

function getRiskOption(properties, riskLevel) {
  const options = properties["Risk Level"]?.select?.options || [];
  const option = options.find(
    (item) => item.name.toLowerCase() === riskLevel.toLowerCase(),
  );

  if (!option) {
    throw new Error(
      'Risk Level must have select options for "Low", "Medium", and "High".',
    );
  }

  return option.name;
}

async function getSchema(notion, id) {
  const database = await notion.databases.retrieve({ database_id: id });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No Notion data source was found.");

  let source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  let properties = source.properties || database.properties || {};
  const additions = {};
  if (properties["Email Status"]?.type !== "status") additions["Email Status"] = { status: {} };
  if (!properties["Risk Level"]) {
    additions["Risk Level"] = {
      select: {
        options: [{ name: "Low" }, { name: "Medium" }, { name: "High" }],
      },
    };
  } else if (properties["Risk Level"].type !== "select") {
    throw new Error('Notion property "Risk Level" must be a select property.');
  }

  if (Object.keys(additions).length) {
    await notion.dataSources.update({ data_source_id: dataSourceId, properties: additions });
    source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    properties = source.properties || {};
  }
  return { dataSourceId, properties };
}

async function logEvent(notion, eventType, actionId, details, isSuccessful) {
  const id = logsDatabaseId();
  if (!id) return;

  await notion.pages.create({
    parent: { database_id: id },
    properties: {
      action_id: title(actionId),
      event_type: select(eventType),
      // The existing log database allows SUCCESS and ERROR in execution_status.
      execution_status: status(isSuccessful ? "SUCCESS" : "ERROR"),
      error_details: richText(details),
    },
  });
}

export async function POST(request) {
  const actionId = randomUUID();
  let data = normalize(null);
  let wasMalformed = true;
  let saved = false;
  let details = "Saved broken student request to main DB for warden inspection.";

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const rawText = typeof body?.request === "string"
      ? body.request.trim().slice(0, 5000)
      : "";
    const notionApiKey = process.env.NOTION_API_KEY;
    const leaveId = databaseId();

    if (!notionApiKey || !leaveId || !logsDatabaseId()) {
      throw new Error(
        "NOTION_API_KEY, NOTION_LEAVE_DATABASE_ID, and NOTION_LOGS_DATABASE_ID are required.",
      );
    }

    if (rawText && process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: rawText,
          config: {
            systemInstruction:
              "Extract the request into the schema. Convert dates to YYYY-MM-DD, calculate inclusive number_days, and generate a polite parent_draft_message. Assess misuse risk, not emotional seriousness: use Low for ordinary or urgent legitimate reasons such as bereavement, a family death, funeral, illness, or a family emergency; use Medium or High only when the text contains concrete suspicious indicators such as contradictory details, explicit repeated rule-breaking, or implausible frequency. Do not classify a request as High merely because it uses emotional or urgent language. Use null for unavailable dates or emails. Return JSON only and set email_status to Not_Sent.",
            responseMimeType: "application/json",
            responseSchema: leaveRequestSchema,
          },
        });
        data = normalize(JSON.parse(response.text?.trim() || "{}"));
      } catch (error) {
        details = `Gemini fallback used: ${errorMessage(error)}`;
      }
    }

    wasMalformed = isMalformed(data);
    data = applyRiskRules(data, rawText);
    if (wasMalformed) {
      details = "Saved broken student request to main DB for warden inspection.";
    }

    const notion = new Client({ auth: notionApiKey });
    const { properties } = await getSchema(notion, leaveId);
    data.risk_level = getRiskOption(properties, data.risk_level);
    await notion.pages.create({
      parent: { database_id: leaveId },
      properties: {
        "Student Name": title(data.student_name),
        "Room no": richText(data.room_number),
        Destination: richText(data.destination),
        Reason: richText(data.reason),
        "Out Date": date(data.out_date),
        "In Date": date(data.in_date),
        "No. of Days": number(data.number_days),
        "Student Email": email(data.student_email),
        "Parent Email": email(data.parents_email),
        "Parent Draft": richText(data.parent_draft_message),
        Status: status("Not started"),
        "Gate Pass ID": richText(null),
        "Email Status": status(data.email_status),
        "Risk Level": select(data.risk_level),
      },
    });

    saved = true;
    return Response.json({ success: true, data, malformed: wasMalformed });
  } catch (error) {
    details = errorMessage(error);
    console.error("Leave request processing failed:", { actionId, message: details });
    return Response.json({ error: "Unable to save the leave request.", details }, { status: 502 });
  } finally {
    try {
      const notionApiKey = process.env.NOTION_API_KEY;
      if (notionApiKey && logsDatabaseId()) {
        await logEvent(
          new Client({ auth: notionApiKey }),
          wasMalformed ? "FAILED_INPUT" : "INBOUND_PARSE",
          actionId,
          details,
          saved && !wasMalformed,
        );
      }
    } catch (error) {
      console.error("Failed to write submission log:", errorMessage(error));
    }
  }
}
