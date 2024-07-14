type TemplateVariables = Record<string, unknown> | Map<string, unknown>;

export function renderTemplate(template: string, variables: TemplateVariables): string {
  const getVariable = (key: string) => {
    if (variables instanceof Map) {
      return variables.get(key);
    }
    return variables[key];
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = getVariable(key);
    return value != null ? String(value) : match;
  });
}

export function compileTemplate(template: string): (variables: TemplateVariables) => string {
  return (variables: TemplateVariables) => renderTemplate(template, variables);
}