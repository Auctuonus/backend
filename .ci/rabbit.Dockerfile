FROM rabbitmq:4.2.2-management-alpine

RUN apk add --no-cache curl

ENV PATH="/opt/rabbitmq/sbin:${PATH}"

RUN curl -L \
  https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v4.2.0/rabbitmq_delayed_message_exchange-4.2.0.ez \
  -o /opt/rabbitmq/plugins/rabbitmq_delayed_message_exchange-4.2.0.ez \
 && chown rabbitmq:rabbitmq /opt/rabbitmq/plugins/rabbitmq_delayed_message_exchange-4.2.0.ez \
 && rabbitmq-plugins enable --offline rabbitmq_delayed_message_exchange \
 && rabbitmq-plugins list --enabled