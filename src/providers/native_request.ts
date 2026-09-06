import { isJsonObject, type JsonObject } from "../requests/sse";
import { BadRequestError } from "../utils/error";

export type NativeProtocol = "messages" | "generateContent" | "converse";

const SUPPORTED_FIELDS = new Set([
  "model",
  "messages",
  "max_tokens",
  "max_completion_tokens",
  "stream",
  "stream_options",
  "temperature",
  "top_p",
  "n",
  "stop",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
]);

export function unsupportedNativeField(field: string): never {
  throw new BadRequestError(
    `Native inference conversion does not support ${field}. Use a provider pass-through route for native fields.`,
  );
}

function object(value: unknown, field: string): JsonObject {
  if (!isJsonObject(value)) return unsupportedNativeField(field);
  return value;
}

function objects(value: unknown, field: string): JsonObject[] {
  if (!Array.isArray(value)) return unsupportedNativeField(field);
  return value.map((item) => object(item, field));
}

function textPart(text: unknown, protocol: NativeProtocol): JsonObject {
  if (typeof text !== "string")
    return unsupportedNativeField("non-text content");
  return protocol === "messages" ? { type: "text", text } : { text };
}

function contentParts(
  content: unknown,
  protocol: NativeProtocol,
): JsonObject[] {
  if (content === null || content === undefined) return [];
  if (typeof content === "string") return [textPart(content, protocol)];
  return objects(content, "messages.content").map((part) => {
    if (part.type === "text") return textPart(part.text, protocol);
    if (part.type !== "image_url")
      return unsupportedNativeField("messages.content");
    const url = object(part.image_url, "image_url").url;
    if (typeof url !== "string") return unsupportedNativeField("image_url");
    const inline = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(
      url,
    );
    if (protocol === "messages") {
      if (!inline && !/^https?:\/\//.test(url))
        return unsupportedNativeField("image_url");
      return {
        type: "image",
        source: inline
          ? { type: "base64", media_type: inline[1], data: inline[2] }
          : { type: "url", url },
      };
    }
    if (!inline)
      return unsupportedNativeField("non-base64 images for this endpoint");
    return protocol === "generateContent"
      ? { inlineData: { mimeType: inline[1], data: inline[2] } }
      : {
          image: { format: inline[1]!.slice(6), source: { bytes: inline[2] } },
        };
  });
}

function toolCall(call: JsonObject, protocol: NativeProtocol): JsonObject {
  if (call.type !== "function" || typeof call.id !== "string")
    return unsupportedNativeField("tool_calls");
  const fn = object(call.function, "tool_calls.function");
  if (typeof fn.name !== "string")
    return unsupportedNativeField("tool_calls.function.name");
  let input: unknown;
  try {
    input = JSON.parse(String(fn.arguments));
  } catch {
    return unsupportedNativeField("non-JSON tool arguments");
  }
  object(input, "non-object tool arguments");
  if (protocol === "messages")
    return { type: "tool_use", id: call.id, name: fn.name, input };
  if (protocol === "converse")
    return { toolUse: { toolUseId: call.id, name: fn.name, input } };
  const extra =
    isJsonObject(call.extra_content) && isJsonObject(call.extra_content.google)
      ? call.extra_content.google
      : {};
  return {
    functionCall: { id: call.id, name: fn.name, args: input },
    ...(typeof extra.thought_signature === "string"
      ? { thoughtSignature: extra.thought_signature }
      : {}),
  };
}

function toolDefinition(
  tool: JsonObject,
  protocol: NativeProtocol,
): JsonObject {
  if (tool.type !== "function")
    return unsupportedNativeField("non-function tools");
  const fn = object(tool.function, "tools.function");
  if (typeof fn.name !== "string")
    return unsupportedNativeField("tools.function.name");
  const schema = fn.parameters ?? { type: "object", properties: {} };
  const common = {
    name: fn.name,
    ...(fn.description !== undefined ? { description: fn.description } : {}),
  };
  if (protocol === "messages") return { ...common, input_schema: schema };
  if (protocol === "converse")
    return { toolSpec: { ...common, inputSchema: { json: schema } } };
  return { ...common, parametersJsonSchema: schema };
}

function toolChoice(value: unknown, protocol: NativeProtocol): JsonObject {
  const name = isJsonObject(value)
    ? object(value.function, "tool_choice.function").name
    : undefined;
  if (
    name === undefined &&
    value !== "auto" &&
    value !== "none" &&
    value !== "required"
  )
    return unsupportedNativeField("tool_choice");
  if (name !== undefined && typeof name !== "string")
    return unsupportedNativeField("tool_choice.function.name");
  if (protocol === "messages")
    return name !== undefined
      ? { type: "tool", name }
      : { type: value === "required" ? "any" : value };
  if (protocol === "converse") {
    if (value === "none")
      return unsupportedNativeField("tool_choice=none for Converse");
    return name !== undefined
      ? { tool: { name } }
      : { [value === "required" ? "any" : "auto"]: {} };
  }
  return {
    functionCallingConfig: {
      mode:
        name !== undefined || value === "required"
          ? "ANY"
          : value === "none"
            ? "NONE"
            : "AUTO",
      ...(name !== undefined ? { allowedFunctionNames: [name] } : {}),
    },
  };
}

export function prepareNativeRequest(
  data: Readonly<JsonObject> & { model: string },
  protocol: NativeProtocol,
): JsonObject {
  for (const field of Object.keys(data)) {
    if (!SUPPORTED_FIELDS.has(field))
      return unsupportedNativeField("unmapped request fields");
  }
  const messages: JsonObject[] = [];
  const system: JsonObject[] = [];
  const toolNames = new Map<string, unknown>();
  const appendMessage = (role: unknown, parts: JsonObject[]) =>
    messages.push(
      protocol === "generateContent"
        ? { role: role === "assistant" ? "model" : role, parts }
        : { role, content: parts },
    );
  for (const message of objects(data.messages, "messages")) {
    if (message.function_call !== undefined)
      return unsupportedNativeField("messages.function_call");
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string")
        return unsupportedNativeField("tool_call_id");
      if (protocol === "messages") {
        appendMessage("user", [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: contentParts(message.content, protocol),
          },
        ]);
      } else if (protocol === "converse") {
        appendMessage("user", [
          {
            toolResult: {
              toolUseId: message.tool_call_id,
              content: contentParts(message.content, protocol),
            },
          },
        ]);
      } else {
        const name = toolNames.get(message.tool_call_id);
        if (!name)
          return unsupportedNativeField(
            "a tool result without a preceding call",
          );
        appendMessage("user", [
          {
            functionResponse: {
              name,
              id: message.tool_call_id,
              response: { result: message.content },
            },
          },
        ]);
      }
      continue;
    }
    const parts = contentParts(message.content, protocol);
    if (message.role === "system" || message.role === "developer") {
      for (const part of parts) system.push(part);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant")
      return unsupportedNativeField("messages.role");
    if (message.tool_calls !== undefined) {
      for (const call of objects(message.tool_calls, "tool_calls")) {
        parts.push(toolCall(call, protocol));
        if (protocol === "generateContent")
          toolNames.set(call.id as string, (call.function as JsonObject).name);
      }
    }
    appendMessage(message.role, parts);
  }
  const maxTokens = data.max_completion_tokens ?? data.max_tokens;
  const result: JsonObject =
    protocol === "generateContent"
      ? {
          contents: messages,
          ...(system.length ? { systemInstruction: { parts: system } } : {}),
        }
      : {
          ...(protocol === "messages" ? { model: data.model } : {}),
          messages,
          ...(system.length ? { system } : {}),
        };
  const config: JsonObject = {};
  if (maxTokens !== undefined)
    config[protocol === "generateContent" ? "maxOutputTokens" : "maxTokens"] =
      maxTokens;
  if (data.temperature !== undefined) config.temperature = data.temperature;
  if (data.top_p !== undefined) config.topP = data.top_p;
  if (data.stop !== undefined)
    config.stopSequences =
      typeof data.stop === "string" ? [data.stop] : data.stop;
  if (data.n !== undefined) {
    if (protocol !== "generateContent" && data.n !== 1)
      return unsupportedNativeField("n other than 1 for this endpoint");
    if (protocol === "generateContent") config.candidateCount = data.n;
  }
  if (protocol === "messages") {
    if (maxTokens === undefined)
      return unsupportedNativeField(
        "Messages requests without max_tokens or max_completion_tokens",
      );
    result.max_tokens = maxTokens;
    for (const key of ["stream", "temperature", "top_p"])
      if (data[key] !== undefined) result[key] = data[key];
    if (config.stopSequences !== undefined)
      result.stop_sequences = config.stopSequences;
  } else {
    result[
      protocol === "generateContent" ? "generationConfig" : "inferenceConfig"
    ] = config;
  }
  if (data.tools !== undefined) {
    const tools = objects(data.tools, "tools").map((tool) =>
      toolDefinition(tool, protocol),
    );
    if (protocol === "converse") result.toolConfig = { tools };
    else
      result.tools =
        protocol === "messages" ? tools : [{ functionDeclarations: tools }];
  }
  if (data.tool_choice !== undefined) {
    const choice = toolChoice(data.tool_choice, protocol);
    if (protocol === "converse")
      result.toolConfig = {
        ...(result.toolConfig as JsonObject),
        toolChoice: choice,
      };
    else
      result[protocol === "messages" ? "tool_choice" : "toolConfig"] = choice;
  }
  if (data.parallel_tool_calls === false) {
    if (protocol !== "messages")
      return unsupportedNativeField(
        "parallel_tool_calls=false for this endpoint",
      );
    result.tool_choice = {
      ...((result.tool_choice as JsonObject) ?? { type: "auto" }),
      disable_parallel_tool_use: true,
    };
  }
  if (data.response_format !== undefined) {
    const format = object(data.response_format, "response_format");
    if (format.type !== "text") {
      if (format.type !== "json_schema" && format.type !== "json_object")
        return unsupportedNativeField("response_format.type");
      const schema =
        format.type === "json_schema"
          ? object(format.json_schema, "response_format.json_schema").schema
          : undefined;
      if (protocol === "messages") {
        if (!isJsonObject(schema))
          return unsupportedNativeField(
            "response_format without json_schema for Messages",
          );
        result.output_config = { format: { type: "json_schema", schema } };
      } else if (protocol === "converse") {
        if (!isJsonObject(schema))
          return unsupportedNativeField(
            "response_format without json_schema for Converse",
          );
        const spec = format.json_schema as JsonObject;
        result.outputConfig = {
          textFormat: {
            type: "json_schema",
            structure: {
              jsonSchema: { name: spec.name, schema: JSON.stringify(schema) },
            },
          },
        };
      } else {
        Object.assign(config, {
          responseMimeType: "application/json",
          ...(schema !== undefined ? { responseJsonSchema: schema } : {}),
        });
      }
    }
  }
  return result;
}
