# Partial JSON scanner

The state machine that makes progressive rendering possible.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> ExpectValue: root frame

    ExpectValue: expect value
    ExpectKey: expect key
    ExpectColon: expect colon
    ExpectComma: expect comma
    InKeyString: in string (isKey = true)
    InValString: in string (isKey = false)
    InBareToken: bare token (number or literal)
    Invalid: structurally impossible

    ExpectValue --> InValString: double quote
    ExpectValue --> ExpectKey: open brace — push object frame
    ExpectValue --> ExpectValue: open bracket — push array frame
    ExpectValue --> InBareToken: digit, t, f or n

    InValString --> ExpectComma: closing quote — commit = i+1
    InBareToken --> ExpectComma: delimiter, if token is complete

    ExpectKey --> InKeyString: double quote
    InKeyString --> ExpectColon: closing quote
    ExpectColon --> ExpectValue: colon

    ExpectComma --> ExpectKey: comma, inside an object
    ExpectComma --> ExpectValue: comma, inside an array
    ExpectComma --> ExpectComma: close brace or bracket — pop frame, commit = i+1

    ExpectValue --> Invalid: unexpected character
    ExpectComma --> Invalid: unexpected character
    Invalid --> [*]: return null
```

## The one distinction everything rests on

`InKeyString` and `InValString` are the same characters on the wire. The scanner
separates them because they are **rewound differently at end of buffer**:

| EOF state | Cut to | Result |
|---|---|---|
| `InValString` | buffer end, minus a dangling escape | close the string: `{"title":"Quarterly rev"}` |
| `InKeyString` | the frame's `commit` | discard the key: `{"a":1,"ti` → `{"a":1}` |

Keeping a partial value is what makes prose stream. Discarding a partial key is
what stops the document lying about its own shape — `{"ti": …}` would be a field
the schema has never heard of, and the validator would call it
`unrecognized_keys`, which is classified **fatal**. A half-written key would
therefore kill the stream on every object the model writes.

## `commit`, and why one assignment carries the algorithm

Every frame tracks the index just past its last *complete* member:

```
member completes → frame.commit = i + 1; frame.expect = "comma"
```

Everything that cannot be salvaged rewinds to `commit`: a dangling `,`, a dangling
`:`, an incomplete literal (`tru`), a number that cannot terminate (`1.2e`, `-`), a
partial key. One field, six failure modes.

## End-of-buffer decision table

| State | Cut point | Then |
|---|---|---|
| In a value string | `trimDanglingEscape(len)` | append `"`, close frames |
| In a key string | `top.commit` | close frames |
| Complete bare token (`true`, `42`) | `len` | close frames |
| Incomplete bare token | `top.commit` | close frames |
| Dangling `,` / `:` / nothing | `top.commit` | close frames |

Closers are appended innermost-first, so `{"a":{"b":[1,2` becomes
`{"a":{"b":[1,2]}}`.

## The escape trap

Appending `"` to `{"s":"a\` gives `{"s":"a\"}` — an *escaped* quote, so the string
never closes and the parse fails. `trimDanglingEscape` handles both cases:

- **odd trailing backslashes** → drop one (even means they are escaped pairs);
- **truncated `\uXXXX`** → look back six characters for a `\u` followed by fewer
  than four hex digits, cut from there.

Both are invisible until they aren't, so both are tested directly.

## Structural rejection

`{"a":1}]` and `{"a" 1}` return `null` rather than a best guess. Guessing would
hand a wrong document to a validator, which is worse than admitting the stream is
broken.
