const PLACEHOLDER = /\{(\w+)\}/gu;

export const fillTemplate = (template: string, variables: Record<string, string>) =>
  template.replaceAll(PLACEHOLDER, (placeholder, key: string) => variables[key] ?? placeholder);
