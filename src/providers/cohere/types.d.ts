// --- Chat ---
// https://docs.cohere.com/reference/chat#response
export type CohereV2ChatResponse = {
  id: string;
  finish_reason: string;
  message: {
    role: string;
    content: {
      type: string;
      text: string;
    }[];
    tool_calls?: {
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
    tool_plan?: string;
    citations?: {
      start?: number;
      end?: number;
      text?: string;
      sources?: (
        | {
            type: string;
            id?: string;
            tool_output?: any;
          }
        | {
            type: string;
            id?: string;
            document?: any;
          }
      )[];
    }[];
  };
  usage?: {
    billed_units?: {
      input_tokens?: number;
      output_tokens?: number;
      search_units?: number;
      classifications?: number;
    };
    tokens: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  logprobs?: {
    token_ids: number[];
    text?: string;
    logprobs: number[];
  }[];
};

// https://docs.cohere.com/reference/chat-stream#response
export type CohereV2ChatChunkResponse =
  | CohereV2ChatChunkMessageStart
  | CohereV2ChatChunkContentStart
  | CohereV2ChatChunkContentDelta
  | CohereV2ChatChunkContentEnd
  | CohereV2ChatChunkToolPlanDelta
  | CohereV2ChatChunkToolCallStart
  | CohereV2ChatChunkToolCallDelta
  | CohereV2ChatChunkToolCallEnd
  | CohereV2ChatChunkCitationStart
  | CohereV2ChatChunkCitationEnd
  | CohereV2ChatChunkMessageEnd
  | CohereV2ChatChunkDebug;

type CohereV2ChatChunkMessageStart = {
  type: "message-start";
  delta?: {
    message: {
      role: string;
    };
  };
  id?: string;
};

type CohereV2ChatChunkContentStart = {
  type: "content-start";
  delta?: {
    message: {
      content: {
        text?: string;
        type?: string;
      };
    };
  };
  index: number;
};

type CohereV2ChatChunkContentDelta = {
  type: "content-delta";
  delta?: {
    message: {
      content: {
        text?: string;
      };
    };
  };
  index?: number;
  logprobs?: {
    token_ids: number[];
    text?: string;
    logprobs: number[];
  }[];
};

type CohereV2ChatChunkContentEnd = {
  type: "content-end";
  index?: number;
};

type CohereV2ChatChunkToolPlanDelta = {
  type: "tool-plan-delta";
  delta?: {
    tool_plan?: string;
  };
};

type CohereV2ChatChunkToolCallStart = {
  type: "tool-call-start";
  delta?: {
    tool_call: {
      id?: string;
      type?: "function";
      function?: {
        name?: string;
        arguments?: string;
      };
    };
  };
  index?: number;
};

type CohereV2ChatChunkToolCallDelta = {
  type: "tool-call-delta";
  delta?: {
    tool_call: {
      function?: {
        arguments?: string;
      };
    };
  };
  index?: number;
};

type CohereV2ChatChunkToolCallEnd = {
  type: "tool-call-end";
  delta?: {
    tool_call?: {
      function?: {
        arguments?: string;
      };
    };
  };
  index?: number;
};

type CohereV2ChatChunkCitationStart = {
  type: "citation-start";
  delta?: {
    message: {
      citations: {
        start?: number;
        end?: number;
        text?: string;
        sources?: (
          | {
              type: string;
              id?: string;
              tool_output?: any;
            }
          | {
              type: string;
              id?: string;
              document?: any;
            }
        )[];
      };
    };
  };
  index?: number;
};

type CohereV2ChatChunkCitationEnd = {
  type: "citation-end";
  index?: number;
};

type CohereV2ChatChunkMessageEnd = {
  type: "message-end";
  delta?: {
    finish_reason?: string;
    usage?: {
      billed_units: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        classifications?: number;
      };
      tokens: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };
  };
  id?: string;
};

type CohereV2ChatChunkDebug = {
  type: "debug";
  prompt?: string;
};

// --- Models ---
// https://docs.cohere.com/reference/list-models
export type CohereModelsListResponseBody = {
  models: {
    name: string;
    endpoints?: string[];
    finetuned?: boolean;
    context_length?: number;
    tokenizer_url?: string;
    default_endpoints?: string[];
  }[];
  next_page_token?: string;
};
