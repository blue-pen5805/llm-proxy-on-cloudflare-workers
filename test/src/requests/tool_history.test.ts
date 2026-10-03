import { describe, expect, it } from "vitest";
import { convertMessagesRequest } from "../../../src/requests/messages/request";
import { convertResponsesRequest } from "../../../src/requests/responses/request";

const call = (id: string) => ({
  id,
  type: "function",
  function: { name: id, arguments: "{}" },
});
const tool = (id: string) => ({ role: "tool", tool_call_id: id, content: id });
const text = (value: string) => ({ type: "text", text: value });

describe("parallel tool conversation history", () => {
  it("groups Messages calls with surrounding text and keeps distinct rounds", () => {
    const use = (id: string) => ({ type: "tool_use", id, name: id, input: {} });
    const result = (id: string) => ({
      type: "tool_result",
      tool_use_id: id,
      content: id,
    });
    const { chat } = convertMessagesRequest({
      model: "test",
      max_tokens: 10,
      messages: [
        {
          role: "assistant",
          content: [
            text("before"),
            use("a"),
            text("between"),
            use("b"),
            text("after"),
          ],
        },
        { role: "user", content: [result("a"), result("b")] },
        { role: "assistant", content: [use("c")] },
        { role: "user", content: [result("c"), text("continue")] },
      ],
    });
    expect(chat.messages).toEqual([
      {
        role: "assistant",
        content: [text("before"), text("between"), text("after")],
        tool_calls: [call("a"), call("b")],
      },
      tool("a"),
      tool("b"),
      { role: "assistant", content: null, tool_calls: [call("c")] },
      tool("c"),
      { role: "user", content: [text("continue")] },
    ]);
  });

  it("merges adjacent Messages assistant messages and retains system positions", () => {
    const { chat } = convertMessagesRequest({
      model: "test",
      max_tokens: 10,
      messages: [
        { role: "assistant", content: [text("one")] },
        {
          role: "assistant",
          content: [
            text("two"),
            { type: "mid_conv_system", content: [text("system")] },
            text("three"),
          ],
        },
      ],
    });
    expect(chat.messages).toEqual([
      { role: "assistant", content: [text("one"), text("two")] },
      { role: "system", content: [text("system")] },
      { role: "assistant", content: [text("three")] },
    ]);
  });

  it("groups parallel calls across adjacent Messages source messages", () => {
    const use = (id: string) => ({ type: "tool_use", id, name: id, input: {} });
    const result = (id: string) => ({
      type: "tool_result",
      tool_use_id: id,
      content: id,
    });
    const { chat } = convertMessagesRequest({
      model: "test",
      max_tokens: 10,
      messages: [
        { role: "assistant", content: [use("a")] },
        { role: "assistant", content: [use("b")] },
        { role: "user", content: [result("a"), result("b")] },
        { role: "assistant", content: "done" },
        { role: "user", content: "again" },
        { role: "assistant", content: [use("c")] },
        { role: "user", content: [result("c")] },
      ],
    });
    expect(chat.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
      tool("a"),
      tool("b"),
      { role: "assistant", content: "done" },
      { role: "user", content: "again" },
      { role: "assistant", content: null, tool_calls: [call("c")] },
      tool("c"),
    ]);
  });

  it("groups Responses function and custom calls across assistant text", () => {
    const inputCall = (id: string) => ({
      type: "function_call",
      call_id: id,
      name: id,
      arguments: "{}",
    });
    const output = (id: string) => ({
      type: "function_call_output",
      call_id: id,
      output: id,
    });
    const { chat } = convertResponsesRequest({
      model: "test",
      input: [
        { role: "assistant", content: "before" },
        inputCall("a"),
        { type: "reasoning", summary: [] },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "between" }],
        },
        { type: "custom_tool_call", call_id: "b", name: "b", input: "run" },
        { role: "assistant", content: "after" },
        output("a"),
        { type: "custom_tool_call_output", call_id: "b", output: "b" },
        inputCall("c"),
        inputCall("d"),
        output("c"),
        output("d"),
        inputCall("e"),
        { role: "assistant", content: "last" },
        output("e"),
      ],
    });
    expect(chat.messages).toEqual([
      {
        role: "assistant",
        content: [text("before"), text("between"), text("after")],
        tool_calls: [
          call("a"),
          { id: "b", type: "custom", custom: { name: "b", input: "run" } },
        ],
      },
      tool("a"),
      tool("b"),
      { role: "assistant", content: null, tool_calls: [call("c"), call("d")] },
      tool("c"),
      tool("d"),
      { role: "assistant", content: [text("last")], tool_calls: [call("e")] },
      tool("e"),
    ]);
  });
});
