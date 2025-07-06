# Development Workflow

> **⚠️ MANDATORY**: You MUST strictly follow this workflow when editing any code. No exceptions.

## Work Process

1. **Start**: Read existing documentation and understand context
2. **Plan**: Create clear objectives and identify required changes
3. **Execute**: Follow the Development Workflow (Explore → Test → Code → Lint & Format → Verify → Document)
4. **Record Log**: Update `.llm_resources/AGENT_WORK_LOG/{YYYY-MM-DD_HH-MM-SS}_{TITLE}.md` with detailed work summary (MANDATORY after EVERY task completion)
5. **Review**: Ensure all changes are properly documented and tested

## Development Workflow

1. **Explore**: Read relevant files before making changes
2. **Test**: Write tests before implementing code
3. **Code**: Follow TypeScript strict mode
4. **Lint & Format**: Run linting and formatting after code changes
5. **Verify**: Run tests, linting and formatting checks
6. **Document**: Create or update documentation for changes

## Code Editing Rules

- **ALWAYS** follow the 6-step Development Workflow above
- **NEVER** skip writing tests before implementing features
- **NEVER** commit code without running verification steps
- **ALWAYS** read existing code and documentation first

## Guidelines

### Code Style Guidelines

- **TypeScript**: Strict mode, target ES2022
- **Imports**: ES modules with destructuring
- **Async**: Prefer async/await over Promise chains
- **Functions**: Arrow functions for callbacks, regular functions for top-level
- **Objects**: Use spread syntax (`{...obj}`) over `Object.assign()`

### Comment Guidelines

- **Language**: English only, be concise
- **Use sparingly**: Only when necessary for clarity
- **Focus on**: Complex logic, workarounds, differences
- **Avoid**: Self-explanatory code, type info (TypeScript handles this)

### Testing Guidelines

- **Coverage**: Write minimal tests covering happy path and error cases only
- **External Dependencies**: Always mock external requests (APIs, databases, etc.)
- **Simplicity**: Keep tests simple and focused on core functionality
- **Structure**: One test file per source file when possible
- **Naming**: Use descriptive test names that explain the scenario
- **Isolation**: Each test should be independent and not rely on others

### Documentation Guidelines

- **Format**: Markdown files in `docs/`
- **Language**: English for main documentation, Japanese translations with `_ja.md` suffix (both languages required)
- **Structure**: Use headings, bullet points, code blocks
- **Simplicity**: Keep it clear and concise
- **Examples**: Include code snippets for complex concepts

### Agent Work Log Guidelines

- **File**: `.llm_resources/AGENT_WORK_LOG/{YYYY-MM-DD_HH-MM-SS}_{TITLE}.md`
- **Timestamp**: Always record execution date and time in `YYYY-MM-DD HH:MM:SS TZ` format with system timezone (use `date` command)
- **Purpose**: Record all LLM agent work sessions with detailed summaries
- **Format**: Date-based entries with clear descriptions of changes made
- **Content**: Include what was changed, why it was changed, and any important notes
- **Updates**: Always update after completing ANY development work (no exceptions)
- **Language**: Use system language for log entries (Japanese for Japanese systems, English for English systems)
- **Frequency**: Update after every single task completion, regardless of size or complexity
