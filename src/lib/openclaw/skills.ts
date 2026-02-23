export type OpenAIToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export const CORE_SWARM_TOOLS: OpenAIToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_past_deliverables',
      description:
        'Search completed (COMPLETED) task deliverables and return relevant markdown excerpts by keyword.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keyword to search in completed task deliverables and summaries.',
            minLength: 1,
          },
        },
        required: ['keyword'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_sub_task',
      description:
        'Create a new child task for a specific role with title, description, and target role id.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short and clear task title.',
            minLength: 1,
          },
          description: {
            type: 'string',
            description: 'Detailed task objective or execution description.',
            minLength: 1,
          },
          target_role_id: {
            type: 'string',
            description: 'Role id that should own this sub-task (e.g., DC-ANL, MC-MAIN).',
            minLength: 1,
          },
        },
        required: ['title', 'description', 'target_role_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_subtasks',
      description:
        'Create multiple child tasks by calling POST /api/swarm/tasks, inheriting current task as parent_task_id.',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1 },
                objective: { type: 'string', minLength: 1 },
                assigned_agent_id: { type: 'string', minLength: 1 },
                execution_order: { type: 'integer', minimum: 0 },
              },
              required: ['title', 'objective', 'assigned_agent_id', 'execution_order'],
              additionalProperties: false,
            },
          },
        },
        required: ['subtasks'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrape_and_parse_url',
      description: 'Fetch a URL and extract clean body text content for downstream analysis.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'HTTP(S) URL to scrape and parse.',
            format: 'uri',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
];
