import { createNcsControlHandler, onNcsControlOptionsRequest } from "./shared";

export const onRequestOptions = onNcsControlOptionsRequest;

// The Pages Function is the producer side of the control queue.
export const onRequestPost = createNcsControlHandler("pause");
