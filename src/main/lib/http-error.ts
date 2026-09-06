/** Error con código HTTP explícito. El error handler de Fastify lo traduce a la respuesta. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
