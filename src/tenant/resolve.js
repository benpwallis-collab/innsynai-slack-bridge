export function resolveTeamId({ message, command, context, body }) {
  return (
    command?.team_id ||
    message?.team ||
    message?.source_team ||
    body?.team_id ||
    context?.teamId ||
    (message?.event_context ? message.event_context.split("-")[1] : null)
  );
}
