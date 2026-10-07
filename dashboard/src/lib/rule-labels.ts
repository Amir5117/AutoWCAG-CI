const RULE_LABELS: Record<string, string> = {
  "image-alt": "Image is missing a text description",
  "input-image-alt": "Image button is missing a text description",
  label: "Form field is missing a label",
  "select-name": "Dropdown is missing a label",
  "button-name": "Button is missing a name",
  "link-name": "Link is missing readable text",
  "color-contrast": "Text is hard to read (low contrast)",
  "aria-hidden-focus": "Hidden content can still be focused",
  "frame-title": "Embedded frame is missing a title",
};

export function describeRule(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? `Accessibility issue (${ruleId.replace(/-/g, " ")})`;
}
