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
    this.data = etherproj.parse_text(selector);
    $.each(this.displays, function(i, d) { d.redraw(); }) // TODO: jQuery-ism
};

// Parser

etherproj.parse_text = function(text) {
    var lines = text.split("\n");
    var nlines = lines.length;
    var tasks = [];

    var task_re = new RegExp("^task\\s+(.*):$");
    var setting_re = new RegExp("^\\s+(\\S+)\\s*:\\s*(.*)$");
    var comment_re = new RegExp("#.*$");
    var ws_re = new RegExp("^\\s*$");

    var matches;
    var task;
    var order = 0;

    for (var i = 0; i < nlines; i++) {
        var line = lines[i];
        // XXX console.log(line);

        // strip comments and skip all-whitespace lines
        line = line.replace(comment_re, '');
        if (ws_re.exec(line)) {
            continue;
        }

        // check for a new task header
        if (matches = task_re.exec(line)) {
            task = {
                name: matches[1],
                // defaults
                title: matches[1],
                duration: 1,
                when: 0,
                order: order,
            };
            tasks.push(task)
            order += 1;
            continue;
        }

        // and for settings
        if (task && (matches = setting_re.exec(line))) {
            var key = matches[1];
            var value = matches[2];
            if (key === 'title') {
                task.title = value;
                continue;
            } else if (key === 'duration') {
                task.duration = parseInt(value);
                continue;
            } else if (key === 'when') {
                task.when = parseInt(value);
                continue;
            }
        }

        // TODO: flag this line as an error
        console.log("ERROR:", line);
        // reset the task so later settings do not apply to the wrong task
        task = null;
    }

    return {
        tasks: tasks,
    };
}

// Gantt chart display

etherproj.Gantt = function(proj, selector) {
    this.proj = proj;

    // parameters
    this.row_height = 20;
    this.day_width = 20;

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

    var x_func = function(d) { return d.when * self.day_width; };
    var y_func = function(d) { return d.order * self.row_height; };
    var width_func = function(d) { return d.duration * self.day_width };
    var height = self.row_height - 2;

    // enter - fade in
    boxes.enter().insert("rect")
        .style("fill-opacity", 0)
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("width", width_func)
        .attr("height", height)
      .transition()
        .duration(500)
        .style("fill-opacity", 1.0);

    // update - move to new shape
    boxes.transition()
        .duration(500)
        .attr("x", x_func)
        .attr("y", y_func)
        .attr("width", width_func)
        .attr("height", height)
        .style("fill-opacity", 1.0);

    // exit -- fade to nothing
    boxes.exit().transition()
        .duration(500)
        .style("fill-opacity", 0)
        .remove();
};
