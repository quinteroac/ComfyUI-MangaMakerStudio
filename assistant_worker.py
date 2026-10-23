import json
import os
import sys

# Abort messages go to stderr; GGML's GDB backtrace would otherwise write to the stdout event stream.
os.environ['GGML_NO_BACKTRACE'] = '1'

from llama_cpp import Llama
from llama_cpp.llama_chat_format import MTMDChatHandler


def emit(event):
    sys.stdout.write(json.dumps(event) + '\n')
    sys.stdout.flush()


class BudgetLlama(Llama):
    def create_completion(self, prompt, *args, **kwargs):
        tokens = len(prompt) if isinstance(prompt, list) else len(self.tokenize(prompt.encode(), special=True))
        if tokens + kwargs['max_tokens'] > self.n_ctx():
            raise ValueError(f"The conversation needs {tokens} input tokens plus {kwargs['max_tokens']} output tokens; the context window is {self.n_ctx()}. "
                             'Clear this module\'s conversation, increase Context, or reduce Maximum answer tokens.')
        emit({'type': 'context', 'input_tokens': tokens, 'context_size': self.n_ctx()})
        return super().create_completion(prompt, *args, **kwargs)


def load(settings):
    handler = MTMDChatHandler(clip_model_path=settings['projector_path'], verbose=True, use_gpu=settings['n_gpu_layers'] != 0) if settings['projector_path'] else None
    kwargs = {'model_path': settings['model_path'], 'n_ctx': settings['n_ctx'], 'n_gpu_layers': settings['n_gpu_layers'], 'n_batch': 512,
              'flash_attn': True, 'chat_handler': handler, 'verbose': True}
    if handler is None and settings['chat_template']:
        kwargs['chat_format'] = 'chat_template.default'
    try:
        return BudgetLlama(**kwargs)
    except (ValueError, MemoryError) as error:
        raise ValueError(f'Could not load the GGUF model ({error}). Reduce Context or GPU layers, or select a smaller model.') from error


def answer(model, request):
    generation = {key: request[key] for key in ('temperature', 'top_p', 'max_tokens')}
    if request['schema']:
        generation['response_format'] = {'type': 'json_object', 'schema': request['schema']}
    if request['thinking'] is not None:
        generation['enable_thinking'] = request['thinking']
    # The public chat method does not forward template kwargs such as enable_thinking.
    handler = model.chat_handler or model._chat_handlers.get(model.chat_format)
    chunks = handler(llama=model, messages=request['messages'], stream=True, **generation) if handler else model.create_chat_completion(request['messages'], stream=True, **generation)
    for chunk in chunks:
        delta = chunk['choices'][0]['delta'].get('content') or ''
        if delta:
            emit({'type': 'delta', 'text': delta})


def main():
    model = None
    try:
        # Requests arrive one JSON line at a time; the parent closes stdin to release the model.
        while line := sys.stdin.readline():
            request = json.loads(line)
            if model is None:
                emit({'type': 'status', 'message': 'Loading model…'})
                model = load(request['load'])
                emit({'type': 'loaded'})
            emit({'type': 'status', 'message': 'Writing…'})
            answer(model, request)
            emit({'type': 'done'})
    except Exception as error:
        emit({'type': 'error', 'message': str(error) or type(error).__name__})
        sys.exit(1)
    finally:
        if model is not None:
            model.close()


if __name__ == '__main__':
    main()
