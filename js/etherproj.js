etherproj = {
    version: "1.0",
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
    var options = {
        gantt: {
            start: Date.today(),
            day_width: 50,
        },
    };
    var options_stanza = function(name) {
        // TODO: verify this is a valid option stanza name
        var current_opts = options[name];

        return function(setting, value) {
            if (setting == "start") {
                var new_start = Date.parse(value);
                if (new_start) {
                    current_opts.start = new_start;
                } else {
                    // TODO: error handling
                }
            } else if (setting == "day width") {
                var new_width = etherproj.safeParseInt(value, 1);
                if (new_width) {
                    current_opts.day_width = new_width;
                } else {
                    // TODO: error handling
                }
            }
            // TODO: error handling
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
                // TODO: assumes days as unit
                task.duration = etherproj.safeParseInt(value, 1);
            } else if (setting === 'after') {
                var date = Date.parse(value);
                if (date) {
                    task.constraints.push({ type: 'after-date', date: date })
                } else {
                    task.constraints.push({ type: 'after-task', name: etherproj.strip(value) })
                }
            } else if (setting === 'before') {
                task.constraints.push({ type: 'before-task', name: etherproj.strip(value) })
            }
            // TODO: error handling
        };
    };

    var stanza_fns = {
        options: options_stanza,
        task: task_stanza,
    };

    var stanza_re = new RegExp("^(task|options)\\s+(.*):$");
    var setting_re = new RegExp("^\\s+([^:]+)\\s*:\\s*(.*)$");
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
            setting_fn(etherproj.strip(matches[1]), etherproj.strip(matches[2]));
            continue;
        }

        // TODO: flag this line as an error in the HTML
        console.log("ERROR:", line);

        // reset the task so later settings do not apply to the wrong task
        setting_fn = null;
    }

    return {
        tasks: tasks,
        options: options,
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
        // TODO: detect collisions
    }

    // convert all "before-task" into the reverse "after-task"
    for (var i = 0; i < ntasks; i++) {
        var t = tasks[i];
        var nconst = t.constraints.length;
        for (var j = 0; j < nconst; j++) {
            var c = t.constraints[j];
            if (c.type == 'before-task') {
                var remote = by_name[c.name];
                if (remote) {
                    remote.constraints.push({ type: 'after-task', name: t.name });
                }
                // TODO: error handling
            }
        }
    }

    // connections between tasks, each represented as a tuple of nodes (before,
    // after)
    var connections = [];

    var default_start = parsed_data.options.gantt.start;

    // now visit all nodes, using depth-first searching
    var visit = function(t) {
        if (t.visited) {
            return;
        }
        t.visited = true;

        // allowed range
        var earliest_start = t.when || default_start.clone();
        var latest_start = null;

        // TODO: stack to prevent loops

        // visit constraints
        var nconst = t.constraints.length;
        for (var i = 0; i < nconst; i++) {
            var c = t.constraints[i];
            // c.type == before-task was handled in the loop above
            if (c.type === 'after-task') {
                var pq = by_name[c.name];
                if (pq) {
                    visit(pq);
                    if (earliest_start.compareTo(pq.end) < 0) {
                        earliest_start = pq.end;
                    }
                    connections.push([pq, t]);
                } else {
                    // TODO report error
                }
            } else if (c.type == 'after-date') {
                var when = c.date;
                if (earliest_start.compareTo(when) < 0) {
                    earliest_start = when;
                }
            }
        }
        t.when = earliest_start;
        t.end = earliest_start.clone().add(t.duration).days();
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
        tasks: tasks,
        connections: connections,
        options: parsed_data.options,
    };
}

// Gantt chart display

etherproj.Gantt = function(proj, selector) {
    this.proj = proj;

    // parameters
    this.row_height = 20;
    this.axis_height = 18;
    this.axis_padding = 20;
    this.day_width = 50;
    this.tick_width = 50;
    this.transition_duration = 500;

    this.div = d3.select(selector);
    this.svg = this.div.append("svg")
         .attr("class", "etherproj-gantt")
         .attr("width", this.day_width * 2 + 2 * this.axis_padding)
         .attr("height", this.axis_height + this.row_height)
         .attr("fill-opacity", 0)
         .attr("stroke-opacity", 0);
    this.axis_g = this.svg.insert('g').attr('class', 'axis')
        .attr('transform', 'translate(' + this.axis_padding + ', 0)');
    this.content_g = this.svg.insert('g')
        .attr('transform', 'translate(' + this.axis_padding + ', ' + this.axis_height + ')');
    this.tasks_g = this.content_g.insert('g').attr('class', 'tasks');
    this.conns_g = this.content_g.insert('g').attr('class', 'conns');
};

etherproj.Gantt.prototype.redraw = function() {
    var self = this;

    // update from options
    self.day_width = self.proj.data.options.gantt.day_width;

    // calculate minima and maxima from the data
    var min_date, max_date;
    if (self.proj.data.tasks.length > 1) {
        min_date = new Date(d3.min(self.proj.data.tasks, function(d) { return +(d.when); }));
        max_date = new Date(d3.max(self.proj.data.tasks, function(d) { return +(d.end); }));
    } else {
        min_date = Date.parse('yesterday');
        max_date = Date.parse('tomorrow');
    }

    var max_order;
    if (self.proj.data.tasks.length > 0) {
        max_order = d3.max(self.proj.data.tasks, function(d) { return d.order; }) + 1;
    } else {
        max_order = 1;
    }

    // Calculate new height and width
    var content_width = self.day_width * (max_date - min_date) / (1000 * 3600 * 24);
    var svg_width = content_width + 2 * self.axis_padding;
    var svg_height = self.axis_height + self.row_height * max_order;

    // X axis scales along available dates
    var x = d3.time.scale().domain([min_date, max_date]).range([0, content_width]);

    // Y axis is based on task order
    var y = d3.scale.linear().domain([0, max_order]).range([0, self.row_height * max_order]);

    // animate the SVG that new size
    this.svg.transition()
        .duration(self.transition_duration)
        .attr("width", svg_width)
        .attr("height", svg_height)
        .attr("stroke-opacity", 1.0)
        .attr("fill-opacity", 1.0);

    self.redraw_axis(x, y, content_width);
    self.redraw_tasks(x, y, content_width);
    self.redraw_conns(x, y, content_width);
};

etherproj.Gantt.prototype.redraw_axis = function(x,  y, content_width) {
    var self = this;
    var axis = d3.svg.axis().scale(x).ticks(content_width / self.tick_width).tickSize(4, 2, 0);

    this.axis_g.transition()
        .duration(self.transition_duration)
        .call(axis);
}

etherproj.Gantt.prototype.redraw_tasks = function(x,  y) {
    var self = this;

    var task_x = function(d) { return x(d.when); };
    var task_y = function(d) { return y(d.order); };

    var box_height = self.row_height - 2;
    var text_func = function(d) { return d.title };
    var width_func = function(d) { return x(d.end) - x(d.when); };

    var taskgs = self.tasks_g.selectAll("g").filter('.task')
        .data(self.proj.data.tasks, function(d) { return d.name });
    var taskgs_enter = taskgs.enter().insert("g")
        .attr('class', 'task');
    var taskgs_exit = taskgs.exit();

    // functions to set/update values on each shape
    var box_fn = function(sel, include_fixed) {
        if (include_fixed) {
            sel .attr("height", box_height)
                .attr("rx", 3)
                .attr("ry", 3);
        }
        sel .attr("x", task_x)
            .attr("y", task_y)
            .attr("width", width_func);
    };
    var text_fn = function(sel, include_fixed) {
        if (include_fixed) {
            sel .attr("dx", 3)
                .attr("dy", self.row_height - 7);
        }
        sel .attr("x", task_x)
            .attr("y", task_y)
            .text(text_func);
    };

    // enter - fade in
    taskgs_enter
        .style("fill-opacity", 0)
        .style("stroke-opacity", 0)
      .transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0)
        .style("stroke-opacity", 1.0);

    box_fn(taskgs_enter.insert("rect"), true);
    text_fn(taskgs_enter.insert("text"), true);

    // update - move to new shape
    taskgs.transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0)
        .style("stroke-opacity", 1.0);

    box_fn(taskgs.select("rect").transition()
            .duration(this.transition_duration));
    text_fn(taskgs.select("text").transition()
        .duration(this.transition_duration));

    // exit -- fade taskgs to nothing and remove
    taskgs_exit.transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 0)
        .style("stroke-opacity", 0)
        .remove();
};

etherproj.Gantt.prototype.redraw_conns = function(x,  y) {
    var self = this;

    var conn_path_fn = function(d) {
        var before = d[0], after = d[1];

        // Draw a two-segment bezier curve, stopping off at the midpoint
        // beteween the start and end.  The control points are over the
        // midpoint, unless the start and end times are the same, in which case
        // they're a few units before/after
        var few_units = 15;
        
        var bx = x(before.end);
        var by = y(before.order + 0.5);
        var ax = x(after.when);
        var ay = y(after.order + 0.5);

        // halfway point
        var hx = (ax + bx) / 2;
        var hy = (ay + by) / 2;

        // and the X coordinate of the control point
        var cx = hx;
        if (cx < bx + few_units / 2) {
            cx = bx + few_units / 2;
        } else if (cx > bx + 3 * few_units) {
            cx = bx + 3 * few_units;
        }

        var pt = function(x,y) { return x + "," + y; };

        return "M" + pt(bx,by) + " Q" + pt(cx, by) + " " + pt(hx, hy) + " T" + pt(ax,ay);
    };

    var conns = self.conns_g.selectAll("path").filter('.conn')
        .data(self.proj.data.connections, function(d) { return d[0].name + '|' + d[1].name; });
    var conns_enter = conns.enter().insert("path")
        .attr('class', 'conn');
    var conns_exit = conns.exit();

    conns_enter
        .style("stroke-opacity", 0)
        .attr('d', conn_path_fn)
      .transition()
        .duration(this.transition_duration)
        .style("stroke-opacity", 0.6);

    conns.transition()
        .duration(this.transition_duration)
        .attr('d', conn_path_fn)
        .style("stroke-opacity", 0.6);

    conns_exit.transition()
        .duration(this.transition_duration)
        .style("stroke-opacity", 0)
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
