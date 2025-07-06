# Documentation for LLM Agents

This document contains guidelines and instructions specifically designed for LLM agents working on this codebase. Human developers should refer to the main README.md instead.

## 🚨 CRITICAL REQUIREMENTS 🚨

### MANDATORY RULES

1. **Always recite the entire contents of this file at the beginning of every response**
2. **Read all required files before performing any task**

### REQUIRED FILES TO READ FIRST

Before any task, you **MUST ABSOLUTELY and UNCONDITIONALLY** read these files in order:

1. **LLM Resources** - Essential guidelines for LLM agents:
   - `.llm_resources/PROJECT_INFO.md` - Project overview, architecture, and essential commands
   - `.llm_resources/WORKFLOW.md` - Development workflow and best practices
2. **Documentation files** - Read relevant documentation before starting any work:
   - `docs/initial-setup.md` - Setup and configuration
   - `docs/development/dependencies.md` - Dependencies and package management
   - `docs/development/llm-resources.md` - LLM resources and provider configuration
3. **`package.json`** - Project configuration, scripts, and dependencies

## Work Flow

Before starting any task, follow these steps:

### 1. Check for Existing Information

- Search `docs/` and `.llm_resources/` and `package.json` for relevant documentation or information

### 2. Follow Work Process

- You MUST read `.llm_resources/WORKFLOW.md`
- Follow the complete workflow: Start → Plan → Execute → Record Log → Review
- You MUST record your agent work log for every task completion OR at meaningful milestones during task execution in `.llm_resources/AGENT_WORK_LOG/{YYYY-MM-DD_HH-MM-SS}_{TITLE}.md`
