import {
  defaultTweakValues,
  getTemplate,
  renderStackCompose,
  type StackTemplate,
} from "@/lib/stack-templates";

export function buildComposeFromTemplate(
  templateId: string,
  tweakValues: Record<string, string>,
): string {
  const template = getTemplate(templateId);
  if (!template) return "";
  return renderStackCompose(template, { ...defaultTweakValues(template), ...tweakValues });
}

export function initialTweaksForTemplate(template: StackTemplate): Record<string, string> {
  return defaultTweakValues(template);
}

export function parseExposedPorts(yaml: string): string[] {
  const ports: string[] = [];
  const re = /^\s*-\s*["']?(\d+):\d+/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml)) !== null) {
    ports.push(m[1]);
  }
  return [...new Set(ports)];
}
