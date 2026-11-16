<?php

// Existing project options, shared with the frontend; not a claim about clinic locations.
return json_decode(file_get_contents(resource_path('branch-code-options.json')), true, flags: JSON_THROW_ON_ERROR);
