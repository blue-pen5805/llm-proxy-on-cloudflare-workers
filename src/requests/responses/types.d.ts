import type { JsonObject } from "../sse";

export interface ResponsesPromptCacheBreakpoint extends JsonObject {
  mode: "explicit";
}

export interface ResponsesTextContentPart extends JsonObject {
  type: "input_text" | "output_text" | "text";
  text: string;
  prompt_cache_breakpoint?: ResponsesPromptCacheBreakpoint;
}

export interface ResponsesRefusalContentPart extends JsonObject {
  type: "refusal";
  refusal: string;
}

export interface ResponsesImageContentPart extends JsonObject {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail?: "auto" | "low" | "high" | string | null;
  prompt_cache_breakpoint?: ResponsesPromptCacheBreakpoint;
}

export interface ResponsesFileContentPart extends JsonObject {
  type: "input_file";
  file_id?: string;
  file_data?: string;
  file_url?: string;
  filename?: string;
  detail?: unknown;
  prompt_cache_breakpoint?: ResponsesPromptCacheBreakpoint;
}

export interface ResponsesExtensionContentPart extends JsonObject {
  type: string;
}

export type ResponsesContentPart =
  | ResponsesTextContentPart
  | ResponsesRefusalContentPart
  | ResponsesImageContentPart
  | ResponsesFileContentPart
  | ResponsesExtensionContentPart;

export interface ResponsesMessageItem extends JsonObject {
  role: "user" | "assistant" | "system" | "developer" | string;
  content: string | ResponsesContentPart[];
}

export interface ResponsesFunctionCallItem extends JsonObject {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponsesCustomToolCallItem extends JsonObject {
  type: "custom_tool_call";
  call_id: string;
  name: string;
  input: string;
}

export interface ResponsesToolCallOutputItem extends JsonObject {
  type: "function_call_output" | "custom_tool_call_output";
  call_id: string;
  output: unknown;
}

export interface ResponsesExtensionInputItem extends JsonObject {
  type?: string;
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesCustomToolCallItem
  | ResponsesToolCallOutputItem
  | ResponsesExtensionInputItem;

export interface ResponsesFunctionTool extends JsonObject {
  type: "function";
  name: string;
  description?: string;
  parameters?: JsonObject;
  strict?: boolean | null;
}

export interface ResponsesCustomTool extends JsonObject {
  type: "custom";
  name: string;
  description?: string;
  format?: JsonObject;
}

export interface ResponsesExtensionTool extends JsonObject {
  type: string;
}

export type ResponsesTool =
  | ResponsesFunctionTool
  | ResponsesCustomTool
  | ResponsesExtensionTool;

export interface ResponsesNamedToolChoice extends JsonObject {
  type: "function" | "custom";
  name: string;
}

export interface ResponsesAllowedToolsChoice extends JsonObject {
  type: "allowed_tools";
  mode: "auto" | "required" | string;
  tools: ResponsesNamedToolChoice[];
}

export type ResponsesToolChoice =
  | string
  | ResponsesNamedToolChoice
  | ResponsesAllowedToolsChoice
  | JsonObject;

export interface ResponsesReasoningConfig extends JsonObject {
  effort?: string | null;
  summary?: unknown;
  context?: unknown;
}

export interface ResponsesTextFormat extends JsonObject {
  type: "text" | "json_object" | "json_schema" | string;
  name?: string;
  schema?: JsonObject;
  description?: string;
  strict?: boolean;
}

export interface ResponsesTextConfig extends JsonObject {
  format?: ResponsesTextFormat;
  verbosity?: "low" | "medium" | "high" | string | null;
}

export interface ResponsesStreamOptions extends JsonObject {
  include_obfuscation?: boolean;
}

export type ResponsesInclude =
  | "message.output_text.logprobs"
  | "reasoning.encrypted_content"
  | string;

/** Request fields accepted by the Responses compatibility endpoint. */
export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  frequency_penalty?: number | null;
  include?: ResponsesInclude[];
  instructions?: string | null;
  logprobs?: boolean | null;
  max_output_tokens?: number | null;
  metadata?: JsonObject | null;
  moderation?: JsonObject | null;
  parallel_tool_calls?: boolean | null;
  presence_penalty?: number | null;
  prompt_cache_key?: string | null;
  prompt_cache_options?: JsonObject | null;
  prompt_cache_retention?: string | null;
  reasoning?: ResponsesReasoningConfig | null;
  safety_identifier?: string | null;
  seed?: number | null;
  service_tier?: string | null;
  store?: boolean | null;
  stream?: boolean | null;
  stream_options?: ResponsesStreamOptions | null;
  temperature?: number | null;
  text?: ResponsesTextConfig | null;
  tool_choice?: ResponsesToolChoice;
  tools?: ResponsesTool[];
  top_logprobs?: number | null;
  top_p?: number | null;
  user?: string | null;

  // Known fields without a Chat Completions conversion are accepted and ignored.
  background?: unknown;
  context_management?: unknown;
  conversation?: unknown;
  max_tool_calls?: unknown;
  previous_response_id?: unknown;
  prompt?: unknown;
  truncation?: unknown;
}
