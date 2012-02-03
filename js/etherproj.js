etherproj = {
    version: 1.0,
};

// Top-level interface

etherproj.Project = function() {
    this.displays = [];
    this.data = { tasks: [] };
}

// watch a textarea element and parse the text from it
etherproj.Project.prototype.watch_text = function(selector, delay) {
    var self = this;
    var timer_id = null;

    var update =  function() {
        timer_id = null;
        self.set_text($(selector).val()); // TODO: jQuery-ism
    };

    var changed = function() {
        if (timer_id) {
            window.clearTimeout(timer_id);
        }
        timer_id = window.setTimeout(update, delay);
    };

    var elt = d3.select(selector);
    elt.on('change', changed);
    elt.on('input', changed);
    elt.on('propertychange', changed);

    // update (almost) immediately
    $(document).ready(update); // TODO: jQuery-ism
};

// add a div in which to display a gantt chart
etherproj.Project.prototype.display_gantt = function(selector) {
    this.displays.push(new etherproj.Gantt(this, selector));
};

// display based on the given text
etherproj.Project.prototype.set_text = function(selector) {
    this.data = this.solve(this.parse_text(selector));
    $.each(this.displays, function(i, d) { d.redraw(); }) // TODO: jQuery-ism
};

// Parser

etherproj.Project.prototype.parse_text = function(text) {
    var options = {gantt: {}};
    var options_stanza = function(name) {
        // TODO: verify this is a valid option stanza name
        var current_opts = options[name];

        return function(setting, value) {
            // TODO: verify this is a valid value
            current_opts[setting] = value;
        };
    };

    var tasks = [];
    var task_stanza = function(name) {
        task = {
            name: name,
            // default values
            title: name,
            duration: 1,
            constraints: [],
        };
        tasks.push(task)

        return function(setting, value) {
            if (setting === 'title') {
                task.title = value;
            } else if (setting === 'duration') {
                task.duration = etherproj.safeParseInt(value, 1);
            } else if (setting === 'when') {
                task.when = parseInt(value);
            } else if (setting === 'after') {
                task.constraints.push({ type: 'prereq', name: etherproj.strip(value) })
            }
            // TODO: error handling
        };
    };

    var stanza_fns = {
        options: options_stanza,
        task: task_stanza,
    };

    var stanza_re = new RegExp("^(task|options)\\s+(.*):$");
    var setting_re = new RegExp("^\\s+(\\S+)\\s*:\\s*(.*)$");
    var comment_re = new RegExp("#.*$");
    var ws_re = new RegExp("^\\s*$");

    var lines = text.split("\n");
    var nlines = lines.length;
    var matches;
    var setting_fn;
    for (var i = 0; i < nlines; i++) {
        var line = lines[i];

        // strip comments and skip all-whitespace lines
        line = line.replace(comment_re, '');
        if (ws_re.exec(line)) {
            continue;
        }

        // check for a new stanza header
        if (matches = stanza_re.exec(line)) {
            var name = etherproj.strip(matches[2]);
            setting_fn = stanza_fns[matches[1]](name);
            continue;
        }

        // ..and for settings
        if (setting_fn && (matches = setting_re.exec(line))) {
            setting_fn(matches[1], matches[2]);
            continue;
        }

        // TODO: flag this line as an error in the HTML
        console.log("ERROR:", line);

        // reset the task so later settings do not apply to the wrong task
        setting_fn = null;
    }

    console.log(tasks);
    console.log(options);
    return {
        tasks: tasks,
    };
}

// Solver

etherproj.Project.prototype.solve = function(parsed_data) {
    var tasks = parsed_data.tasks;
    var ntasks = parsed_data.tasks.length;

    // get the tasks keyed by name, for easy dependency-finding
    var by_name = {__proto__:null};
    for (var i = 0; i < ntasks; i++) {
        var t = tasks[i];
        by_name[t.name] = t;
    }

    // now visit all nodes, using depth-first searching
    var visit = function(n) {
        if (n.visited) {
            return;
        }
        n.visited = true;

        // allowed range
        var earliest = 0;

        // TODO: stack to prevent loops

        // visit constraints
        var nconst = n.constraints.length;
        for (var i = 0; i < nconst; i++) {
            var c = n.constraints[i];
            if (c.type === 'prereq') {
                var pq = by_name[c.name];
                if (pq) {
                    visit(pq);
                    earliest = Math.max(earliest, pq.when + pq.duration);
                } else {
                    // TODO report error
                }
            }
        }
        n.when = earliest;
    }
    for (var i = 0; i < ntasks; i++) {
        visit(tasks[i]);
    }

    // sort by 'when', and use that to define the order
    tasks.sort(function (a,b) {
        return a.when - b.when || b.duration - a.duration;
    });
    for (var i = 0; i < ntasks; i++) {
        tasks[i].order = i;
    }

    return {
        tasks: tasks
    };
}

// Gantt chart display

etherproj.Gantt = function(proj, selector) {
    this.proj = proj;

    // parameters
    this.row_height = 20;
    this.day_width = 20;
    this.transition_duration = 500;

    this.div = d3.select(selector);
    this.svg = this.div.append("svg")
         .attr("class", "etherproj-gantt")
         .attr("width", 500)
         .attr("height", 500);
};

etherproj.Gantt.prototype.redraw = function() {
    var self = this;

    var boxes = self.svg.selectAll("rect")
        .data(self.proj.data.tasks, function(d) { return d.name });
    var text = self.svg.selectAll("text")
        .data(self.proj.data.tasks, function(d) { return d.name });

    var x_func = function(d) { return d.when * self.day_width; };
    var y_func = function(d) { return d.order * self.row_height; };
    var width_func = function(d) { return d.duration * self.day_width };
    var text_func = function(d) { return d.title };
    var height = self.row_height - 2;

    // enter - fade in
    boxes.enter().insert("rect")
        // fixed
        .attr("height", height)
        .attr("rx", 3)
        .attr("ry", 3)
        // variable
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("width", width_func)
        .style("fill-opacity", 0)
      .transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0);

    text.enter().insert("text")
        // fixed
        .attr("dx", 3)
        .attr("dy", self.row_height - 7)
        // variable
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("class", "task")
        .text(text_func)
        .style("fill-opacity", 0)
      .transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0);

    // update - move to new shape
    boxes.transition()
        .duration(this.transition_duration)
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("width", width_func)
        .style("fill-opacity", 1.0);

    text.transition()
        .duration(this.transition_duration)
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("class", "task")
        .text(text_func)
        .style("fill-opacity", 1.0);

    // exit -- fade to nothing
    boxes.exit().transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 0)
        .remove();

    text.exit().transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 0)
        .remove();
};

// Utilities

etherproj.safeParseInt = function(s, d) {
    var v = parseInt(s);
    if (isNaN(v)) {
        return d;
    }
    return v;
};

etherproj.strip = function(s) {
    return s.replace(/^\s+|\s+$/g, '');
}
